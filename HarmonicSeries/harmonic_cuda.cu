#include "harmonic_runner.hpp"

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_cuda_session.hpp"
#include "harmonic_poc_report.hpp"
#include "harmonic_output.hpp"

#include <cuda_runtime.h>

#include <atomic>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <thread>
#include <vector>

namespace harmonic {

namespace {

__global__ void __launch_bounds__(256, 2) harmonic_chunk_kernel(
    uint64_t chunk_size,
    int num_chunks,
    int sum_mode_int,
    double *chunk_totals,
    int *error_flags)
{
    const int idx = static_cast<int>(blockIdx.x * blockDim.x + threadIdx.x);
    if (idx >= num_chunks)
        return;

    const uint64_t chunk_index = static_cast<uint64_t>(idx) + 1U;
    const auto range = chunk_range(chunk_index, chunk_size);
    const SumMode mode = static_cast<SumMode>(sum_mode_int);

    double total = 0.0;
    if (!sum_chunk_range(range.start, range.end, mode, total))
        error_flags[idx] = 1;
    else
        chunk_totals[idx] = total;
}

__global__ void harmonic_head_range_kernel(double *out_head, uint64_t head_start, uint64_t head_end)
{
    if (blockIdx.x != 0 || threadIdx.x != 0)
        return;
    double head_sum = 0.0;
    sum_chunk_adaptive(head_start, head_end, head_sum);
    *out_head = head_sum;
}

__global__ void __launch_bounds__(256, 2) harmonic_tail_kernel(
    uint64_t tail_start,
    uint64_t tail_chunk_size,
    uint64_t tail_end,
    int num_chunks,
    double *chunk_totals)
{
    const int idx = static_cast<int>(blockIdx.x * blockDim.x + threadIdx.x);
    if (idx >= num_chunks)
        return;

    const uint64_t start = tail_start + static_cast<uint64_t>(idx) * tail_chunk_size;
    if (start > tail_end)
    {
        chunk_totals[idx] = 0.0;
        return;
    }

    uint64_t end = start + tail_chunk_size - 1;
    if (end > tail_end)
        end = tail_end;

    double total = 0.0;
    sum_chunk_kahan_turbo(start, end, total);
    chunk_totals[idx] = total;
}

// Kahan-merge chunk partials on device; one scalar D2H instead of num_chunks doubles.
__global__ void harmonic_kahan_reduce_kernel(const double *chunk_totals, int count, double *out)
{
    if (blockIdx.x != 0 || threadIdx.x != 0)
        return;
    double sum = 0.0;
    double comp = 0.0;
    for (int i = 0; i < count; ++i)
        kahan_add(sum, comp, chunk_totals[i]);
    *out = sum;
}

void check_cuda(cudaError_t err, const char *what)
{
    if (err != cudaSuccess)
    {
        std::cerr << "CUDA error in " << what << ": " << cudaGetErrorString(err) << "\n";
        std::exit(1);
    }
}

double merge_chunks_host(const std::vector<double> &chunks, SumMode mode)
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

double device_reduce_chunks(CudaSession &session, int active_chunks)
{
    harmonic_kahan_reduce_kernel<<<1, 1>>>(session.d_totals, active_chunks, session.d_reduced);
    check_cuda(cudaGetLastError(), "kahan reduce");
    check_cuda(cudaDeviceSynchronize(), "kahan reduce sync");
    double out = 0.0;
    check_cuda(cudaMemcpy(&out, session.d_reduced, sizeof(double), cudaMemcpyDeviceToHost), "reduce memcpy");
    return out;
}

bool run_cuda_turbo_range_session(
    const Config &cfg,
    CudaSession &session,
    RunStats &stats,
    int num_chunks,
    uint64_t range_start,
    uint64_t range_end)
{
    if (range_start > range_end)
        return false;

    stats.terms_processed = range_end - range_start + 1;

    const uint64_t head_lo = range_start;
    const uint64_t head_hi = (range_end < TAIL_KAHAN_THRESHOLD) ? range_end : TAIL_KAHAN_THRESHOLD;
    const uint64_t tail_lo = (range_start > TAIL_KAHAN_THRESHOLD) ? range_start : (TAIL_KAHAN_THRESHOLD + 1U);
    const uint64_t tail_hi = range_end;

    const bool do_head = head_lo <= head_hi;
    const bool do_tail = tail_lo <= tail_hi && tail_lo <= range_end;

    double final_sum = 0.0;
    double final_comp = 0.0;

    if (do_head)
    {
        harmonic_head_range_kernel<<<1, 1>>>(session.d_head, head_lo, head_hi);
        check_cuda(cudaGetLastError(), "head kernel");
        check_cuda(cudaDeviceSynchronize(), "head sync");
        double head_sum = 0.0;
        check_cuda(cudaMemcpy(&head_sum, session.d_head, sizeof(double), cudaMemcpyDeviceToHost), "head memcpy");
        kahan_add(final_sum, final_comp, head_sum);
        if (!cfg.quiet)
            std::cout << "head [" << head_lo << ".." << head_hi << "]: " << head_sum << "\n";
    }

    if (do_tail)
    {
        const uint64_t tail_terms = tail_hi - tail_lo + 1;
        const uint64_t tail_chunk_size =
            (tail_terms + static_cast<uint64_t>(num_chunks) - 1U) / static_cast<uint64_t>(num_chunks);

        constexpr int threads_per_block = 256;
        const int blocks = (num_chunks + threads_per_block - 1) / threads_per_block;
        harmonic_tail_kernel<<<blocks, threads_per_block>>>(
            tail_lo, tail_chunk_size, tail_hi, num_chunks, session.d_totals);
        check_cuda(cudaGetLastError(), "tail kernel");
        check_cuda(cudaDeviceSynchronize(), "tail sync");

        const double tail_total = device_reduce_chunks(session, num_chunks);
        kahan_add(final_sum, final_comp, tail_total);
        if (!cfg.quiet)
            std::cout << "tail [" << tail_lo << ".." << tail_hi << "]: " << tail_total << "\n";
    }

    stats.final_sum = final_sum;
    return true;
}

bool run_cuda_chunk_range_session(
    const Config &cfg,
    CudaSession &session,
    RunStats &stats,
    int num_chunks,
    uint64_t range_start,
    uint64_t range_end,
    SumMode mode)
{
    const uint64_t terms = range_end - range_start + 1;
    const uint64_t chunk_size = (terms + static_cast<uint64_t>(num_chunks) - 1U) / static_cast<uint64_t>(num_chunks);
    const int sum_mode_int = static_cast<int>(mode);

    check_cuda(cudaMemset(session.d_errors, 0, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMemset err");

    constexpr int tpb = 256;
    const int blocks = (num_chunks + tpb - 1) / tpb;

    harmonic_chunk_kernel<<<blocks, tpb>>>(chunk_size, num_chunks, sum_mode_int, session.d_totals, session.d_errors);
    check_cuda(cudaDeviceSynchronize(), "chunk sync");

    std::vector<int> h_errors(static_cast<size_t>(num_chunks));
    check_cuda(cudaMemcpy(h_errors.data(), session.d_errors, static_cast<size_t>(num_chunks) * sizeof(int),
                    cudaMemcpyDeviceToHost),
        "memcpy err");

    for (int i = 0; i < num_chunks; ++i)
        if (h_errors[static_cast<size_t>(i)] != 0)
            return false;

    if (mode == SumMode::Fast)
    {
        stats.final_sum = device_reduce_chunks(session, num_chunks);
    }
    else
    {
        std::vector<double> h_totals(static_cast<size_t>(num_chunks));
        check_cuda(cudaMemcpy(h_totals.data(), session.d_totals, static_cast<size_t>(num_chunks) * sizeof(double),
                        cudaMemcpyDeviceToHost),
            "memcpy totals");
        stats.final_sum = merge_chunks_host(h_totals, mode);
    }

    stats.terms_processed = terms;
    return true;
}

} // namespace

bool cuda_is_available()
{
    int count = 0;
    return cudaGetDeviceCount(&count) == cudaSuccess && count > 0;
}

bool cuda_init_device(const Config &cfg, std::string &gpu_name)
{
    int device_count = 0;
    check_cuda(cudaGetDeviceCount(&device_count), "cudaGetDeviceCount");
    if (device_count == 0)
        return false;
    if (cfg.cuda_device < 0 || cfg.cuda_device >= device_count)
        return false;
    check_cuda(cudaSetDevice(cfg.cuda_device), "cudaSetDevice");
    cudaDeviceProp prop{};
    check_cuda(cudaGetDeviceProperties(&prop, cfg.cuda_device), "cudaGetDeviceProperties");
    gpu_name = prop.name;
    return true;
}

bool cuda_session_init(CudaSession &session, const Config &cfg, std::string &gpu_name)
{
    if (session.ready)
        cuda_session_fini(session);

    if (!cuda_init_device(cfg, gpu_name))
        return false;

    session.num_chunks = static_cast<int>(resolve_worker_count(cfg));
    session.cuda_device = cfg.cuda_device;

    check_cuda(cudaMalloc(&session.d_head, sizeof(double)), "cudaMalloc head");
    check_cuda(cudaMalloc(&session.d_totals, static_cast<size_t>(session.num_chunks) * sizeof(double)),
        "cudaMalloc totals");
    check_cuda(cudaMalloc(&session.d_reduced, sizeof(double)), "cudaMalloc reduced");
    check_cuda(cudaMalloc(&session.d_errors, static_cast<size_t>(session.num_chunks) * sizeof(int)),
        "cudaMalloc err");
    session.ready = true;
    return true;
}

void cuda_session_fini(CudaSession &session)
{
    if (session.d_head)
        cudaFree(session.d_head);
    if (session.d_totals)
        cudaFree(session.d_totals);
    if (session.d_reduced)
        cudaFree(session.d_reduced);
    if (session.d_errors)
        cudaFree(session.d_errors);
    session = CudaSession{};
}

bool cuda_session_run_range(
    CudaSession &session,
    const Config &cfg,
    RunStats &stats,
    uint64_t range_start,
    uint64_t range_end,
    bool verbose)
{
    if (!session.ready || session.num_chunks != static_cast<int>(resolve_worker_count(cfg)))
        return false;

    check_cuda(cudaSetDevice(session.cuda_device), "cudaSetDevice");

    const SumMode mode = resolve_sum_mode(cfg);

    if (verbose)
        std::cout << "CUDA range [" << range_start << " .. " << range_end << "]"
                  << "  chunks: " << session.num_chunks
                  << "  mode: " << sum_mode_name(mode) << "\n";

    if (uses_turbo_cuda_path(mode))
        return run_cuda_turbo_range_session(cfg, session, stats, session.num_chunks, range_start, range_end);

    return run_cuda_chunk_range_session(
        cfg, session, stats, session.num_chunks, range_start, range_end, mode);
}

bool run_cuda_index_range(
    const Config &cfg,
    RunStats &stats,
    uint64_t range_start,
    uint64_t range_end,
    bool verbose)
{
    CudaSession session;
    if (!cuda_session_init(session, cfg, stats.gpu_name))
        return false;

    if (verbose)
        std::cout << "  device: " << stats.gpu_name << "\n";

    const bool ok = cuda_session_run_range(session, cfg, stats, range_start, range_end, verbose);
    cuda_session_fini(session);
    return ok;
}

bool run_cuda(const Config &cfg, RunStats &stats)
{
    int device_count = 0;
    check_cuda(cudaGetDeviceCount(&device_count), "cudaGetDeviceCount");
    if (device_count == 0)
    {
        std::cerr << "No CUDA devices found.\n";
        return false;
    }
    if (cfg.cuda_device < 0 || cfg.cuda_device >= device_count)
    {
        std::cerr << "Invalid --cuda-device " << cfg.cuda_device << "\n";
        return false;
    }

    const int num_chunks = static_cast<int>(resolve_worker_count(cfg));
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    const uint64_t total_end = resolve_global_end(cfg);
    const SumMode mode = resolve_sum_mode(cfg);
    const bool json_out = is_json_output(cfg);

    if (!json_out)
    {
        std::cout << "Backend: CUDA\n";
        std::cout << "Range: [1 .. " << total_end << "]\n";
        std::cout << "Chunks: " << num_chunks << "  chunk size: " << chunk_size
                  << "  sum-mode: " << sum_mode_name(mode);
        if (uses_turbo_cuda_path(mode))
            std::cout << "  [split-head + tail kernel + device reduce]";
        std::cout << "\n";
    }

    std::atomic<bool> progress_done{false};
    std::thread progress_thread;
    if (cfg.progress_json)
    {
        progress_thread = std::thread([&]() {
            const auto t0 = std::chrono::steady_clock::now();
            while (!progress_done.load())
            {
                const auto now = std::chrono::steady_clock::now();
                const double elapsed = std::chrono::duration<double>(now - t0).count();
                emit_progress_json(0.0, elapsed, 0, cfg.global_n > 0 ? cfg.global_n : total_end);
                std::this_thread::sleep_for(std::chrono::seconds(2));
            }
        });
    }

    const auto t0 = std::chrono::steady_clock::now();

    if (!run_cuda_index_range(cfg, stats, 1, total_end, !json_out && !cfg.quiet))
    {
        progress_done.store(true);
        if (progress_thread.joinable())
            progress_thread.join();
        return false;
    }

    const auto t1 = std::chrono::steady_clock::now();
    progress_done.store(true);
    if (progress_thread.joinable())
        progress_thread.join();

    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();

    if (cfg.progress_json)
        emit_progress_json(stats.final_sum, stats.elapsed_sec, stats.terms_processed,
            cfg.global_n > 0 ? cfg.global_n : total_end);

    if (!json_out)
    {
        std::cout << std::fixed;
        std::cout.precision(15);
        std::cout << "Final sum: " << stats.final_sum
                  << "   sec: " << stats.elapsed_sec
                  << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec)
                  << std::endl;

        if (cfg.poc_report)
            print_poc_scaling_report(cfg, stats);
    }

    return true;
}

bool list_cuda_gpus_json()
{
    int device_count = 0;
    if (cudaGetDeviceCount(&device_count) != cudaSuccess || device_count == 0)
    {
        std::cout << "[]" << std::endl;
        return true;
    }

    std::cout << "[";
    for (int i = 0; i < device_count; ++i)
    {
        cudaDeviceProp prop{};
        if (cudaGetDeviceProperties(&prop, i) != cudaSuccess)
            continue;
        if (i > 0)
            std::cout << ",";
        std::cout << "{\"id\":" << i
                  << ",\"name\":\"" << json_escape(prop.name) << "\""
                  << ",\"memory_mb\":" << (prop.totalGlobalMem / (1024 * 1024)) << "}";
    }
    std::cout << "]" << std::endl;
    return true;
}

} // namespace harmonic
