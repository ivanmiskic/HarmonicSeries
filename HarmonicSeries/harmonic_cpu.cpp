#include "harmonic_runner.hpp"

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_output.hpp"
#include "harmonic_poc_report.hpp"

#include <atomic>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <thread>
#include <vector>

namespace harmonic {

namespace {

struct RangeJob {
    uint64_t start;
    uint64_t end;
    size_t job_index;
};

std::vector<double> g_chunk_totals;
std::atomic<bool> g_workers_done{false};
std::atomic<uint64_t> g_terms_done{0};
std::atomic<size_t> g_jobs_completed{0};
time_t g_start_time = 0;
bool g_quiet = false;
bool g_progress_json = false;
uint64_t g_global_n = 0;
SumMode g_sum_mode = SumMode::Adaptive;

void worker_range(const RangeJob &job)
{
    double total = 0.0;
    if (!sum_chunk_range(job.start, job.end, g_sum_mode, total))
    {
        std::cerr << "Range [" << job.start << ".." << job.end << "] overflowed partial buffer (max "
                  << MAX_PARTIALS << ")\n";
        return;
    }

    if (!g_quiet)
        std::cout << "chunk " << job.job_index << ": " << total << std::endl;
    g_chunk_totals[job.job_index] = total;
    g_terms_done.fetch_add(job.end - job.start + 1, std::memory_order_relaxed);
    g_jobs_completed.fetch_add(1, std::memory_order_relaxed);
}

void progress_loop()
{
    while (!g_workers_done.load())
    {
        double sum = 0.0;
        const size_t completed = g_jobs_completed.load(std::memory_order_relaxed);
        for (size_t i = 0; i < completed && i < g_chunk_totals.size(); ++i)
            sum += g_chunk_totals[i];

        const double elapsed = difftime(time(0), g_start_time);
        const uint64_t terms_done = g_terms_done.load(std::memory_order_relaxed);

        if (g_progress_json)
            emit_progress_json(sum, elapsed, terms_done, g_global_n);
        else if (!g_quiet)
            std::cout << std::fixed << std::setprecision(15)
                      << "Running partial total: " << sum
                      << "   sec: " << elapsed << std::endl;

        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
}

double merge_chunks(const std::vector<double> &chunks, SumMode mode)
{
    if (mode == SumMode::Fast || mode == SumMode::Turbo)
    {
        double sum = 0.0;
        double comp = 0.0;
        for (double v : chunks)
            kahan_add(sum, comp, v);
        return sum;
    }

    PartialState merged;
    partial_clear(merged);
    for (double v : chunks)
    {
        if (!partial_add_term(merged, v))
            return 0.0;
    }
    return kahan_sum(merged.cur, merged.cur_count);
}

std::vector<RangeJob> build_cpu_jobs(const Config &cfg, uint64_t range_end)
{
    const size_t workers = resolve_worker_count(cfg);
    const uint64_t chunk_size = resolve_chunk_size(cfg);

    std::vector<RangeJob> jobs;
    if (cfg.global_n > 0 && !cfg.distributed)
    {
        jobs.reserve(workers);
        const uint64_t total = range_end;
        const uint64_t base = total / static_cast<uint64_t>(workers);
        const uint64_t rem = total % static_cast<uint64_t>(workers);
        uint64_t cursor = 1;
        for (size_t i = 0; i < workers; ++i)
        {
            const uint64_t span = base + (i < rem ? 1U : 0U);
            if (span == 0)
                break;
            const uint64_t start = cursor;
            const uint64_t end = cursor + span - 1;
            jobs.push_back({start, end, i});
            cursor = end + 1;
        }
        return jobs;
    }

    jobs.reserve(workers);
    for (size_t i = 0; i < workers; ++i)
    {
        const auto range = chunk_range(i + 1, chunk_size);
        if (range.start > range_end)
            break;
        const uint64_t end = range.end < range_end ? range.end : range_end;
        jobs.push_back({range.start, end, i});
    }
    return jobs;
}

} // namespace

bool run_cpu(const Config &cfg, RunStats &stats)
{
    const uint64_t range_end = resolve_global_end(cfg);
    const auto jobs = build_cpu_jobs(cfg, range_end);
    if (jobs.empty())
    {
        std::cerr << "No CPU work units to run.\n";
        return false;
    }

    g_quiet = cfg.quiet || is_json_output(cfg);
    g_progress_json = cfg.progress_json;
    g_global_n = cfg.global_n;
    g_sum_mode = resolve_sum_mode(cfg);
    g_chunk_totals.assign(jobs.size(), 0.0);
    g_workers_done.store(false);
    g_terms_done.store(0);
    g_jobs_completed.store(0);
    g_start_time = time(0);

    const auto t0 = std::chrono::steady_clock::now();

    if (!is_json_output(cfg))
    {
        std::cout << "Backend: CPU (" << jobs.size() << " threads)\n";
        std::cout << "Range: [1 .. " << range_end << "]  sum-mode: " << sum_mode_name(g_sum_mode) << "\n";
    }

    std::thread progress_thread;
    if (cfg.show_progress || cfg.progress_json)
        progress_thread = std::thread(progress_loop);

    std::vector<std::thread> threads;
    threads.reserve(jobs.size());
    for (const auto &job : jobs)
        threads.emplace_back(worker_range, job);

    for (auto &th : threads)
        th.join();

    g_workers_done.store(true);
    if ((cfg.show_progress || cfg.progress_json) && progress_thread.joinable())
        progress_thread.join();

    const auto t1 = std::chrono::steady_clock::now();
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();
    stats.terms_processed = range_end;
    stats.final_sum = merge_chunks(g_chunk_totals, g_sum_mode);

    if (!is_json_output(cfg))
    {
        std::cout << std::fixed << std::setprecision(15)
                  << "Final sum: " << stats.final_sum
                  << "   sec: " << stats.elapsed_sec
                  << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec)
                  << std::endl;

        if (cfg.poc_report)
            print_poc_scaling_report(cfg, stats);
    }

    return true;
}

} // namespace harmonic
