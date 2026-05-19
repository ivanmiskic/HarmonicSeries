#include "harmonic_distributed.hpp"

#include "harmonic_core.hpp"
#include "harmonic_poc_report.hpp"

#include <arpa/inet.h>
#include <chrono>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <netdb.h>
#include <sstream>
#include <sys/socket.h>
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
    out << "partial_sum " << result.partial_sum << "\n";
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
                  << "  partial=" << nr.partial_sum << "  " << nr.hostname
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
