#include "harmonic_distributed.hpp"

#include "harmonic_core.hpp"
#include "harmonic_cuda_session.hpp"
#include "harmonic_poc_report.hpp"

#include <arpa/inet.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <netdb.h>
#include <sstream>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

namespace harmonic {

namespace {

std::string get_hostname()
{
    char buf[256];
    if (gethostname(buf, sizeof(buf)) == 0)
        return buf;
    return "unknown";
}

bool send_all(int fd, const void *data, size_t len)
{
    const char *p = static_cast<const char *>(data);
    size_t sent = 0;
    while (sent < len)
    {
        const ssize_t n = send(fd, p + sent, len - sent, 0);
        if (n <= 0)
            return false;
        sent += static_cast<size_t>(n);
    }
    return true;
}

bool recv_all(int fd, void *data, size_t len)
{
    char *p = static_cast<char *>(data);
    size_t got = 0;
    while (got < len)
    {
        const ssize_t n = recv(fd, p + got, len - got, 0);
        if (n <= 0)
            return false;
        got += static_cast<size_t>(n);
    }
    return true;
}

constexpr char kWorkRequest = 'Q';

#pragma pack(push, 1)
struct WorkReply {
    int64_t unit_id;
    uint64_t start;
    uint64_t end;
};
#pragma pack(pop)

} // namespace

uint64_t total_work_units(uint64_t global_n, uint64_t work_unit)
{
    if (global_n == 0 || work_unit == 0)
        return 0;
    return (global_n + work_unit - 1U) / work_unit;
}

bool work_unit_to_range(int64_t unit_id, uint64_t work_unit, uint64_t global_n, WorkUnitRange &out)
{
    if (unit_id < 0)
        return false;
    const uint64_t u = static_cast<uint64_t>(unit_id);
    const uint64_t start = u * work_unit + 1U;
    if (start > global_n)
        return false;
    const uint64_t end = (u + 1U) * work_unit;
    out.unit_id = unit_id;
    out.start = start;
    out.end = end < global_n ? end : global_n;
    return true;
}

namespace {

class WorkQueueCoordinator {
public:
    WorkQueueCoordinator(uint64_t global_n, uint64_t work_unit)
        : global_n_(global_n), work_unit_(work_unit),
          total_units_(total_work_units(global_n, work_unit))
    {
    }

    bool assign_unit(WorkUnitRange &out)
    {
        const uint64_t u = next_unit_.fetch_add(1U);
        if (u >= total_units_)
        {
            out.unit_id = -1;
            return false;
        }
        return work_unit_to_range(static_cast<int64_t>(u), work_unit_, global_n_, out);
    }

    uint64_t total_units() const { return total_units_; }

private:
    uint64_t global_n_;
    uint64_t work_unit_;
    uint64_t total_units_;
    std::atomic<uint64_t> next_unit_{0};
};

bool connect_to_leader(const std::string &host, int port, int &out_fd)
{
    out_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (out_fd < 0)
        return false;

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));

    if (inet_pton(AF_INET, host.c_str(), &addr.sin_addr) <= 0)
    {
        hostent *he = gethostbyname(host.c_str());
        if (!he)
        {
            close(out_fd);
            return false;
        }
        std::memcpy(&addr.sin_addr, he->h_addr_list[0], static_cast<size_t>(he->h_length));
    }

    for (int attempt = 0; attempt < 60; ++attempt)
    {
        if (connect(out_fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) == 0)
            return true;
        sleep(1);
    }
    close(out_fd);
    return false;
}

bool request_work_unit(int fd, WorkUnitRange &out)
{
    const char req = kWorkRequest;
    if (!send_all(fd, &req, 1))
        return false;

    WorkReply reply{};
    if (!recv_all(fd, &reply, sizeof(reply)))
        return false;

    if (reply.unit_id < 0)
    {
        out.unit_id = -1;
        return false;
    }

    out.unit_id = reply.unit_id;
    out.start = reply.start;
    out.end = reply.end;
    return true;
}

struct WorkUnitSource {
    virtual ~WorkUnitSource() = default;
    virtual bool fetch(WorkUnitRange &out) = 0;
};

struct RemoteWorkSource final : WorkUnitSource {
    explicit RemoteWorkSource(int fd) : fd_(fd) {}
    bool fetch(WorkUnitRange &out) override { return request_work_unit(fd_, out); }

private:
    int fd_;
};

struct LocalWorkSource final : WorkUnitSource {
    explicit LocalWorkSource(WorkQueueCoordinator &queue) : queue_(queue) {}
    bool fetch(WorkUnitRange &out) override { return queue_.assign_unit(out); }

private:
    WorkQueueCoordinator &queue_;
};

/** Prefetch next work unit on a background thread while the GPU runs the current one. */
class WorkUnitPrefetcher {
public:
    explicit WorkUnitPrefetcher(WorkUnitSource &source) : source_(source) {}

    ~WorkUnitPrefetcher() { shutdown(); }

    bool start()
    {
        if (!source_.fetch(current_))
            return false;
        if (current_.unit_id < 0)
            return false;
        has_current_ = true;
        thread_ = std::thread(&WorkUnitPrefetcher::prefetch_loop, this);
        return true;
    }

    void shutdown()
    {
        if (shutdown_done_.exchange(true))
            return;
        {
            std::lock_guard<std::mutex> lock(mu_);
            stop_ = true;
        }
        cv_fetch_.notify_all();
        cv_use_.notify_all();
        if (thread_.joinable())
            thread_.join();
    }

    bool current(WorkUnitRange &out) const
    {
        if (!has_current_)
            return false;
        out = current_;
        return true;
    }

    // After GPU finishes current unit: wait for prefetched next. Returns false on EOF or error.
    bool advance(WorkUnitRange &out, bool &eof)
    {
        eof = false;
        if (!has_current_)
            return false;

        {
            std::lock_guard<std::mutex> lock(mu_);
            cv_use_.notify_one();
        }

        std::unique_lock<std::mutex> lock(mu_);
        cv_fetch_.wait(lock, [this] { return next_ready_ || stop_ || prefetch_failed_; });

        if (prefetch_failed_)
            return false;

        if (next_.unit_id < 0)
        {
            has_current_ = false;
            eof = true;
            return false;
        }

        current_ = next_;
        next_ready_ = false;
        cv_use_.notify_one();
        out = current_;
        return true;
    }

private:
    void prefetch_loop()
    {
        while (true)
        {
            WorkUnitRange fetched{};
            const bool ok = source_.fetch(fetched);

            {
                std::lock_guard<std::mutex> lock(mu_);
                if (stop_)
                    return;
                if (!ok)
                {
                    prefetch_failed_ = true;
                    next_.unit_id = -1;
                }
                else if (fetched.unit_id < 0)
                {
                    next_.unit_id = -1;
                }
                else
                {
                    next_ = fetched;
                }
                next_ready_ = true;
            }
            cv_fetch_.notify_one();

            std::unique_lock<std::mutex> lock(mu_);
            cv_use_.wait(lock, [this] { return !next_ready_ || stop_; });
            if (stop_)
                return;
        }
    }

    WorkUnitSource &source_;
    WorkUnitRange current_{};
    WorkUnitRange next_{};
    bool has_current_ = false;
    bool next_ready_ = false;
    bool prefetch_failed_ = false;
    bool stop_ = false;
    std::atomic<bool> shutdown_done_{false};
    std::mutex mu_;
    std::condition_variable cv_fetch_;
    std::condition_variable cv_use_;
    std::thread thread_;
};

bool run_prefetched_cuda_units(
    const Config &cfg,
    CudaSession &session,
    WorkUnitPrefetcher &prefetch,
    double &acc_sum,
    double &acc_comp,
    uint64_t &terms_done,
    uint64_t &units_done)
{
    WorkUnitRange range;
    if (!prefetch.current(range))
        return true;

    for (;;)
    {
        RunStats chunk{};
        if (!cuda_session_run_range(session, cfg, chunk, range.start, range.end, false))
            return false;
        kahan_add(acc_sum, acc_comp, chunk.final_sum);
        terms_done += chunk.terms_processed;
        ++units_done;

        bool eof = false;
        if (!prefetch.advance(range, eof))
        {
            if (eof)
                return true;
            return false;
        }
    }
}

void serve_worker_loop(int client_fd, WorkQueueCoordinator &queue, std::atomic<bool> &stop)
{
    while (!stop.load())
    {
        char req = 0;
        if (!recv_all(client_fd, &req, 1))
            break;
        if (req != kWorkRequest)
            break;

        WorkReply reply{};
        WorkUnitRange range;
        if (queue.assign_unit(range))
        {
            reply.unit_id = range.unit_id;
            reply.start = range.start;
            reply.end = range.end;
        }
        else
        {
            reply.unit_id = -1;
            reply.start = 0;
            reply.end = 0;
        }

        if (!send_all(client_fd, &reply, sizeof(reply)))
            break;
        if (reply.unit_id < 0)
            break;
    }
    close(client_fd);
}

bool run_dynamic_worker_loop(
    const Config &cfg,
    int work_fd,
    double &acc_sum,
    double &acc_comp,
    uint64_t &terms_done,
    uint64_t &units_done,
    std::string &gpu_name)
{
    CudaSession session;
    if (!cuda_session_init(session, cfg, gpu_name))
        return false;

    RemoteWorkSource source(work_fd);
    WorkUnitPrefetcher prefetch(source);
    if (!prefetch.start())
    {
        cuda_session_fini(session);
        return true;
    }

    const bool ok = run_prefetched_cuda_units(cfg, session, prefetch, acc_sum, acc_comp, terms_done, units_done);
    prefetch.shutdown();
    cuda_session_fini(session);
    return ok;
}

bool run_dynamic_leader_loop(
    const Config &cfg,
    WorkQueueCoordinator &queue,
    int worker_fd,
    double &acc_sum,
    double &acc_comp,
    uint64_t &terms_done,
    uint64_t &units_done,
    std::string &gpu_name)
{
    CudaSession session;
    if (!cuda_session_init(session, cfg, gpu_name))
        return false;

    std::atomic<bool> stop{false};
    std::thread server_thread;
    if (worker_fd >= 0)
        server_thread = std::thread(serve_worker_loop, worker_fd, std::ref(queue), std::ref(stop));

    LocalWorkSource source(queue);
    WorkUnitPrefetcher prefetch(source);
    bool ok = true;
    if (prefetch.start())
        ok = run_prefetched_cuda_units(cfg, session, prefetch, acc_sum, acc_comp, terms_done, units_done);
    prefetch.shutdown();

    stop.store(true);
    if (server_thread.joinable())
        server_thread.join();
    cuda_session_fini(session);
    return ok;
}

bool run_distributed_dynamic(const Config &cfg, RunStats &stats)
{
    const int rank = cfg.dist_rank;
    const int nodes = cfg.dist_nodes;
    const uint64_t work_unit = resolve_work_unit(cfg);
    const uint64_t total_units = total_work_units(cfg.global_n, work_unit);
    const int work_port = cfg.sync_port + 1;

    std::cout << "Distributed dynamic: rank " << rank << "/" << nodes
              << "  global-n=" << cfg.global_n
              << "  work-unit=" << work_unit
              << "  work-units=" << total_units << "\n";

    if (nodes > 1)
    {
        if (rank > 0 && cfg.sync_leader_host.empty())
        {
            std::cerr << "Rank > 0 requires --sync-leader <rank-0 IP>\n";
            return false;
        }
        const std::string leader = cfg.sync_leader_host.empty() ? "0.0.0.0" : cfg.sync_leader_host;
        if (!distributed_sync_barrier(rank, nodes, leader, cfg.sync_port))
            return false;
    }

    int worker_fd = -1;
    int listen_fd = -1;

    if (rank == 0 && nodes > 1)
    {
        listen_fd = socket(AF_INET, SOCK_STREAM, 0);
        if (listen_fd < 0)
            return false;
        int yes = 1;
        setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;
        addr.sin_port = htons(static_cast<uint16_t>(work_port));
        if (bind(listen_fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) < 0)
        {
            std::cerr << "work queue: bind failed on port " << work_port << "\n";
            close(listen_fd);
            return false;
        }
        listen(listen_fd, 1);
        std::cout << "Work queue: listening on port " << work_port << "...\n";
        worker_fd = accept(listen_fd, nullptr, nullptr);
        if (worker_fd < 0)
        {
            close(listen_fd);
            return false;
        }
        std::cout << "Work queue: worker connected\n";
    }
    else if (rank > 0)
    {
        std::cout << "Work queue: connecting to " << cfg.sync_leader_host << ":" << work_port << "...\n";
        if (!connect_to_leader(cfg.sync_leader_host, work_port, worker_fd))
        {
            std::cerr << "Work queue: connect failed\n";
            return false;
        }
    }

    WorkQueueCoordinator queue(cfg.global_n, work_unit);
    double acc_sum = 0.0;
    double acc_comp = 0.0;
    uint64_t terms_done = 0;
    uint64_t units_done = 0;
    std::string gpu_name;

    const auto t0 = std::chrono::steady_clock::now();
    bool ok = false;
    if (rank == 0)
        ok = run_dynamic_leader_loop(cfg, queue, worker_fd, acc_sum, acc_comp, terms_done, units_done, gpu_name);
    else
        ok = run_dynamic_worker_loop(cfg, worker_fd, acc_sum, acc_comp, terms_done, units_done, gpu_name);

    const auto t1 = std::chrono::steady_clock::now();

    if (worker_fd >= 0)
        close(worker_fd);
    if (listen_fd >= 0)
        close(listen_fd);

    if (!ok)
        return false;

    stats.final_sum = acc_sum;
    stats.terms_processed = terms_done;
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();
    stats.gpu_name = gpu_name;

    NodeResult nr;
    nr.rank = rank;
    nr.nodes = nodes;
    nr.range_start = 1;
    nr.range_end = cfg.global_n;
    nr.terms_processed = terms_done;
    nr.work_units_done = units_done;
    nr.partial_sum = acc_sum;
    nr.elapsed_sec = stats.elapsed_sec;
    nr.schedule = "dynamic";
    nr.hostname = get_hostname();
    nr.gpu_name = gpu_name;

    if (!cfg.out_file.empty() && !write_node_result(cfg.out_file, nr))
        return false;

    std::cout << std::fixed << std::setprecision(15);
    std::cout << "Node partial sum: " << stats.final_sum
              << "   units: " << units_done << "/" << total_units
              << "   sec: " << stats.elapsed_sec
              << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec) << "\n";
    return true;
}

} // namespace

IndexRange partition_range(int rank, int nodes, uint64_t global_n)
{
    IndexRange r;
    if (nodes < 1 || rank < 0 || rank >= nodes || global_n == 0)
        return r;

    const uint64_t base = global_n / static_cast<uint64_t>(nodes);
    const uint64_t rem = global_n % static_cast<uint64_t>(nodes);

    uint64_t start = 1;
    for (int i = 0; i < rank; ++i)
        start += base + (static_cast<uint64_t>(i) < rem ? 1U : 0U);

    const uint64_t count = base + (static_cast<uint64_t>(rank) < rem ? 1U : 0U);
    r.start = start;
    r.end = start + count - 1;
    r.term_count = count;
    return r;
}

bool distributed_sync_barrier(int rank, int nodes, const std::string &leader_host, int port)
{
    if (nodes <= 1)
        return true;

    constexpr char go = 'G';

    if (rank == 0)
    {
        const int server_fd = socket(AF_INET, SOCK_STREAM, 0);
        if (server_fd < 0)
        {
            std::cerr << "sync: socket() failed\n";
            return false;
        }

        int yes = 1;
        setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;
        addr.sin_port = htons(static_cast<uint16_t>(port));

        if (bind(server_fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) < 0)
        {
            std::cerr << "sync: bind() failed on port " << port << "\n";
            close(server_fd);
            return false;
        }
        if (listen(server_fd, nodes - 1) < 0)
        {
            std::cerr << "sync: listen() failed\n";
            close(server_fd);
            return false;
        }

        std::cout << "Distributed sync: leader waiting for " << (nodes - 1)
                  << " peer(s) on port " << port << "...\n";

        std::vector<int> clients;
        clients.reserve(static_cast<size_t>(nodes - 1));
        for (int i = 0; i < nodes - 1; ++i)
        {
            const int cfd = accept(server_fd, nullptr, nullptr);
            if (cfd < 0)
            {
                std::cerr << "sync: accept() failed\n";
                close(server_fd);
                return false;
            }
            clients.push_back(cfd);
        }

        std::cout << "Distributed sync: all peers connected — GO\n";
        for (int cfd : clients)
        {
            if (!send_all(cfd, &go, 1))
            {
                std::cerr << "sync: send GO failed\n";
                close(server_fd);
                return false;
            }
            close(cfd);
        }
        close(server_fd);
        return true;
    }

    const int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0)
    {
        std::cerr << "sync: socket() failed\n";
        return false;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));

    if (inet_pton(AF_INET, leader_host.c_str(), &addr.sin_addr) <= 0)
    {
        hostent *he = gethostbyname(leader_host.c_str());
        if (!he)
        {
            std::cerr << "sync: unknown leader host " << leader_host << "\n";
            close(fd);
            return false;
        }
        std::memcpy(&addr.sin_addr, he->h_addr_list[0], static_cast<size_t>(he->h_length));
    }

    std::cout << "Distributed sync: connecting to leader " << leader_host << ":" << port << "...\n";

    for (int attempt = 0; attempt < 120; ++attempt)
    {
        if (connect(fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) == 0)
            break;
        if (attempt == 119)
        {
            std::cerr << "sync: connect() to leader failed (is rank 0 running first?)\n";
            close(fd);
            return false;
        }
        sleep(1);
    }

    char byte = 0;
    if (!recv_all(fd, &byte, 1) || byte != go)
    {
        std::cerr << "sync: did not receive GO from leader\n";
        close(fd);
        return false;
    }

    close(fd);
    std::cout << "Distributed sync: received GO\n";
    return true;
}

bool write_node_result(const std::string &path, const NodeResult &result)
{
    std::ofstream out(path);
    if (!out)
        return false;
    out << std::fixed;
    out.precision(17);
    out << "rank " << result.rank << "\n";
    out << "nodes " << result.nodes << "\n";
    out << "range_start " << result.range_start << "\n";
    out << "range_end " << result.range_end << "\n";
    out << "terms " << result.terms_processed << "\n";
    out << "work_units " << result.work_units_done << "\n";
    out << "partial_sum " << result.partial_sum << "\n";
    out << "schedule " << result.schedule << "\n";
    out << "elapsed_sec " << result.elapsed_sec << "\n";
    out << "hostname " << result.hostname << "\n";
    out << "gpu_name " << result.gpu_name << "\n";
    return true;
}

bool read_node_result(const std::string &path, NodeResult &result)
{
    std::ifstream in(path);
    if (!in)
        return false;

    std::string line;
    while (std::getline(in, line))
    {
        const size_t sp = line.find(' ');
        if (sp == std::string::npos)
            continue;
        const std::string key = line.substr(0, sp);
        const std::string val = line.substr(sp + 1);

        if (key == "rank")
            result.rank = std::stoi(val);
        else if (key == "nodes")
            result.nodes = std::stoi(val);
        else if (key == "range_start")
            result.range_start = std::stoull(val);
        else if (key == "range_end")
            result.range_end = std::stoull(val);
        else if (key == "terms")
            result.terms_processed = std::stoull(val);
        else if (key == "work_units")
            result.work_units_done = std::stoull(val);
        else if (key == "schedule")
            result.schedule = val;
        else if (key == "partial_sum")
            result.partial_sum = std::stod(val);
        else if (key == "elapsed_sec")
            result.elapsed_sec = std::stod(val);
        else if (key == "hostname")
            result.hostname = val;
        else if (key == "gpu_name")
            result.gpu_name = val;
    }
    return result.nodes > 0;
}

bool merge_node_results(const std::vector<std::string> &paths, double &out_total, uint64_t &out_terms)
{
    std::vector<NodeResult> nodes;
    nodes.reserve(paths.size());

    for (const auto &path : paths)
    {
        NodeResult nr;
        if (!read_node_result(path, nr))
        {
            std::cerr << "Failed to read " << path << "\n";
            return false;
        }
        nodes.push_back(nr);
        std::cout << "  rank " << nr.rank << " [" << nr.range_start << ".." << nr.range_end << "]"
                  << "  partial=" << nr.partial_sum << "  units=" << nr.work_units_done
                  << "  " << nr.schedule << "  " << nr.hostname
                  << " / " << nr.gpu_name << "  (" << nr.elapsed_sec << " s)\n";
    }

    double sum = 0.0;
    double comp = 0.0;
    out_terms = 0;
    for (const auto &nr : nodes)
    {
        kahan_add(sum, comp, nr.partial_sum);
        out_terms += nr.terms_processed;
    }
    out_total = sum;
    return true;
}

bool run_distributed_cuda(const Config &cfg, RunStats &stats)
{
    if (!cuda_is_available())
    {
        std::cerr << "CUDA required for distributed mode\n";
        return false;
    }

    if (cfg.dist_dynamic)
        return run_distributed_dynamic(cfg, stats);

    const int rank = cfg.dist_rank;
    const int nodes = cfg.dist_nodes;
    const auto range = partition_range(rank, nodes, cfg.global_n);

    std::cout << "Distributed: rank " << rank << " / " << nodes
              << "  index range [" << range.start << " .. " << range.end << "]"
              << "  (" << range.term_count << " terms)\n";

    if (nodes > 1)
    {
        if (rank > 0 && cfg.sync_leader_host.empty())
        {
            std::cerr << "Rank > 0 requires --sync-leader <rank-0 IP address>\n";
            return false;
        }
        const std::string leader = cfg.sync_leader_host.empty() ? "0.0.0.0" : cfg.sync_leader_host;
        if (!distributed_sync_barrier(rank, nodes, leader, cfg.sync_port))
            return false;
    }

    const auto t0 = std::chrono::steady_clock::now();
    if (!run_cuda_index_range(cfg, stats, range.start, range.end))
        return false;
    const auto t1 = std::chrono::steady_clock::now();
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();

    NodeResult nr;
    nr.rank = rank;
    nr.nodes = nodes;
    nr.range_start = range.start;
    nr.range_end = range.end;
    nr.terms_processed = stats.terms_processed;
    nr.partial_sum = stats.final_sum;
    nr.elapsed_sec = stats.elapsed_sec;
    nr.schedule = "static";
    nr.hostname = get_hostname();
    nr.gpu_name = stats.gpu_name;

    if (!cfg.out_file.empty())
    {
        if (!write_node_result(cfg.out_file, nr))
        {
            std::cerr << "Failed to write " << cfg.out_file << "\n";
            return false;
        }
        std::cout << "Wrote " << cfg.out_file << "\n";
    }

    std::cout << std::fixed;
    std::cout.precision(15);
    std::cout << "Node partial sum: " << stats.final_sum
              << "   sec: " << stats.elapsed_sec
              << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec)
              << "\n";
    std::cout << "Merge on any machine: ./harmonic_series --merge-results";
    for (int r = 0; r < nodes; ++r)
        std::cout << " rank" << r << ".txt";
    std::cout << "\n";

    return true;
}

bool run_merge_mode(const std::vector<std::string> &result_files)
{
    double total = 0.0;
    uint64_t terms = 0;
    std::cout << "Merging " << result_files.size() << " node result(s):\n";
    if (!merge_node_results(result_files, total, terms))
        return false;

    std::cout << std::fixed << std::setprecision(15);
    std::cout << "Merged H_n (partial sums): " << total << "\n";
    std::cout << "Total terms: " << terms << "\n";
    return true;
}

} // namespace harmonic
