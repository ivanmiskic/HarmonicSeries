#include "harmonic_runner.hpp"

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_poc_report.hpp"

#include <cuda_runtime.h>

#include <chrono>
#include <iomanip>
#include <iostream>
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

// Tail-only: [tail_start + idx*chunk_size, min(..., tail_end)]
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

bool run_cuda_turbo_range(
    const Config &cfg,
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
        double *d_head = nullptr;
        check_cuda(cudaMalloc(&d_head, sizeof(double)), "cudaMalloc head");
        harmonic_head_range_kernel<<<1, 1>>>(d_head, head_lo, head_hi);
        check_cuda(cudaDeviceSynchronize(), "head kernel");
        double head_sum = 0.0;
        check_cuda(cudaMemcpy(&head_sum, d_head, sizeof(double), cudaMemcpyDeviceToHost), "head memcpy");
        cudaFree(d_head);
        kahan_add(final_sum, final_comp, head_sum);
        if (!cfg.quiet)
            std::cout << "head [" << head_lo << ".." << head_hi << "]: " << head_sum << "\n";
    }

    if (do_tail)
    {
        const uint64_t tail_terms = tail_hi - tail_lo + 1;
        const uint64_t tail_chunk_size = (tail_terms + static_cast<uint64_t>(num_chunks) - 1U) / static_cast<uint64_t>(num_chunks);

        double *d_totals = nullptr;
        check_cuda(cudaMalloc(&d_totals, static_cast<size_t>(num_chunks) * sizeof(double)), "cudaMalloc totals");

        constexpr int threads_per_block = 256;
        const int blocks = (num_chunks + threads_per_block - 1) / threads_per_block;
        harmonic_tail_kernel<<<blocks, threads_per_block>>>(
            tail_lo, tail_chunk_size, tail_hi, num_chunks, d_totals);
        check_cuda(cudaGetLastError(), "tail kernel");
        check_cuda(cudaDeviceSynchronize(), "tail sync");

        std::vector<double> h_totals(static_cast<size_t>(num_chunks));
        check_cuda(cudaMemcpy(h_totals.data(), d_totals, static_cast<size_t>(num_chunks) * sizeof(double),
                        cudaMemcpyDeviceToHost), "tail memcpy");
        cudaFree(d_totals);

        for (int i = 0; i < num_chunks; ++i)
            if (!cfg.quiet)
                std::cout << "tail chunk " << i << ": " << h_totals[static_cast<size_t>(i)] << std::endl;

        const double tail_total = merge_chunks_host(h_totals, SumMode::Turbo);
        kahan_add(final_sum, final_comp, tail_total);
        if (!cfg.quiet)
            std::cout << "tail [" << tail_lo << ".." << tail_hi << "]: " << tail_total << "\n";
    }

    stats.final_sum = final_sum;
    return true;
}

} // namespace

bool cuda_is_available()
{
    int count = 0;
    return cudaGetDeviceCount(&count) == cudaSuccess && count > 0;
}

bool run_cuda_index_range(const Config &cfg, RunStats &stats, uint64_t range_start, uint64_t range_end)
{
    int device_count = 0;
    check_cuda(cudaGetDeviceCount(&device_count), "cudaGetDeviceCount");
    if (device_count == 0)
        return false;
    check_cuda(cudaSetDevice(cfg.cuda_device), "cudaSetDevice");

    cudaDeviceProp prop{};
    check_cuda(cudaGetDeviceProperties(&prop, cfg.cuda_device), "cudaGetDeviceProperties");
    stats.gpu_name = prop.name;

    const int num_chunks = static_cast<int>(resolve_worker_count(cfg));
    const SumMode mode = resolve_sum_mode(cfg);

    std::cout << "CUDA range [" << range_start << " .. " << range_end << "]"
              << "  device: " << prop.name
              << "  chunks: " << num_chunks
              << "  mode: " << sum_mode_name(mode) << "\n";

    if (uses_turbo_cuda_path(mode))
        return run_cuda_turbo_range(cfg, stats, num_chunks, range_start, range_end);

    const uint64_t terms = range_end - range_start + 1;
    const uint64_t chunk_size = (terms + static_cast<uint64_t>(num_chunks) - 1U) / static_cast<uint64_t>(num_chunks);
    const int sum_mode_int = static_cast<int>(mode);

    double *d_totals = nullptr;
    int *d_errors = nullptr;
    check_cuda(cudaMalloc(&d_totals, static_cast<size_t>(num_chunks) * sizeof(double)), "cudaMalloc");
    check_cuda(cudaMalloc(&d_errors, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMalloc err");
    check_cuda(cudaMemset(d_errors, 0, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMemset");

    constexpr int tpb = 256;
    const int blocks = (num_chunks + tpb - 1) / tpb;

    harmonic_chunk_kernel<<<blocks, tpb>>>(chunk_size, num_chunks, sum_mode_int, d_totals, d_errors);
    check_cuda(cudaDeviceSynchronize(), "chunk sync");

    std::vector<double> h_totals(static_cast<size_t>(num_chunks));
    std::vector<int> h_errors(static_cast<size_t>(num_chunks));
    check_cuda(cudaMemcpy(h_totals.data(), d_totals, static_cast<size_t>(num_chunks) * sizeof(double), cudaMemcpyDeviceToHost),
        "memcpy");
    check_cuda(cudaMemcpy(h_errors.data(), d_errors, static_cast<size_t>(num_chunks) * sizeof(int), cudaMemcpyDeviceToHost),
        "memcpy err");
    cudaFree(d_totals);
    cudaFree(d_errors);

    for (int i = 0; i < num_chunks; ++i)
        if (h_errors[static_cast<size_t>(i)] != 0)
            return false;

    stats.final_sum = merge_chunks_host(h_totals, mode);
    stats.terms_processed = terms;
    return true;
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

    check_cuda(cudaSetDevice(cfg.cuda_device), "cudaSetDevice");

    const int num_chunks = static_cast<int>(resolve_worker_count(cfg));
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    const uint64_t total_end = static_cast<uint64_t>(num_chunks) * chunk_size;
    const SumMode mode = resolve_sum_mode(cfg);

    std::cout << "Backend: CUDA\n";
    std::cout << "Chunks: " << num_chunks << "  chunk size: " << chunk_size
              << "  sum-mode: " << sum_mode_name(mode);
    if (uses_turbo_cuda_path(mode))
        std::cout << "  [split-head + tail kernel]";
    std::cout << "\n";

    const auto t0 = std::chrono::steady_clock::now();

    if (!run_cuda_index_range(cfg, stats, 1, total_end))
        return false;

    const auto t1 = std::chrono::steady_clock::now();
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();

    std::cout << std::fixed;
    std::cout.precision(15);
    std::cout << "Final sum: " << stats.final_sum
              << "   sec: " << stats.elapsed_sec
              << "   terms/s: " << (stats.terms_processed / stats.elapsed_sec)
              << std::endl;

    if (cfg.poc_report)
        print_poc_scaling_report(cfg, stats);

    return true;
}

} // namespace harmonic
