#include "harmonic_runner.hpp"

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
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

std::vector<double> g_chunk_totals;
std::atomic<bool> g_workers_done{false};
time_t g_start_time = 0;
bool g_quiet = false;
SumMode g_sum_mode = SumMode::Adaptive;

void worker(uint64_t chunk_index_1based, uint64_t chunk_size)
{
    const auto range = chunk_range(chunk_index_1based, chunk_size);
    double total = 0.0;
    if (!sum_chunk_range(range.start, range.end, g_sum_mode, total))
    {
        std::cerr << "Chunk " << chunk_index_1based << " overflowed partial buffer (max " << MAX_PARTIALS << ")\n";
        return;
    }

    if (!g_quiet)
        std::cout << "chunk " << (chunk_index_1based - 1) << ": " << total << std::endl;
    g_chunk_totals[chunk_index_1based - 1] = total;
}

void progress_loop()
{
    while (!g_workers_done.load())
    {
        double sum = 0.0;
        for (double v : g_chunk_totals)
            sum += v;

        const double elapsed = difftime(time(0), g_start_time);
        std::cout << std::fixed << std::setprecision(15)
                  << "Running partial total: " << sum
                  << "   sec: " << elapsed << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
}

double merge_chunks(const std::vector<double> &chunks, SumMode mode)
{
    if (mode == SumMode::Fast)
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

} // namespace

bool run_cpu(const Config &cfg, RunStats &stats)
{
    const size_t workers = resolve_worker_count(cfg);
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    g_quiet = cfg.quiet;
    g_sum_mode = cfg.sum_mode;
    g_chunk_totals.assign(workers, 0.0);
    g_workers_done.store(false);
    g_start_time = time(0);

    const auto t0 = std::chrono::steady_clock::now();

    std::cout << "Backend: CPU (" << workers << " threads)\n";
    std::cout << "Chunk size: " << chunk_size << "  sum-mode: " << sum_mode_name(cfg.sum_mode) << "\n";

    std::thread progress_thread;
    if (cfg.show_progress)
        progress_thread = std::thread(progress_loop);

    std::vector<std::thread> threads;
    threads.reserve(workers);
    for (size_t i = 0; i < workers; ++i)
        threads.emplace_back(worker, i + 1, chunk_size);

    for (auto &th : threads)
        th.join();

    g_workers_done.store(true);
    if (cfg.show_progress && progress_thread.joinable())
        progress_thread.join();

    const auto t1 = std::chrono::steady_clock::now();
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();
    stats.terms_processed = workers * chunk_size;
    stats.final_sum = merge_chunks(g_chunk_totals, cfg.sum_mode);

    std::cout << std::fixed << std::setprecision(15)
              << "Final sum: " << stats.final_sum
              << "   sec: " << stats.elapsed_sec
              << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec)
              << std::endl;

    if (cfg.poc_report)
        print_poc_scaling_report(cfg, stats);

    return true;
}

} // namespace harmonic
