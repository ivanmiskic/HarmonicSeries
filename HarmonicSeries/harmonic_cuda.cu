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

__global__ void harmonic_head_kernel(double *out_head, uint64_t head_end)
{
    if (blockIdx.x != 0 || threadIdx.x != 0)
        return;
    double head_sum = 0.0;
    sum_chunk_adaptive(1, head_end, head_sum);
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

bool run_cuda_turbo(
    const Config &cfg,
    RunStats &stats,
    int num_chunks,
    uint64_t /*chunk_size*/,
    uint64_t total_end)
{
    const uint64_t head_end = (total_end < TAIL_KAHAN_THRESHOLD) ? total_end : TAIL_KAHAN_THRESHOLD;
    double head_sum = 0.0;

    const uint64_t tail_start = head_end + 1;
    if (tail_start > total_end)
    {
        double *d_head = nullptr;
        check_cuda(cudaMalloc(&d_head, sizeof(double)), "cudaMalloc head");
        harmonic_head_kernel<<<1, 1>>>(d_head, head_end);
        check_cuda(cudaDeviceSynchronize(), "head only");
        check_cuda(cudaMemcpy(&head_sum, d_head, sizeof(double), cudaMemcpyDeviceToHost), "head memcpy");
        cudaFree(d_head);
        stats.final_sum = head_sum;
        stats.terms_processed = total_end;
        return true;
    }

    const uint64_t tail_terms = total_end - tail_start + 1;
    const uint64_t tail_chunk_size = (tail_terms + static_cast<uint64_t>(num_chunks) - 1U) / static_cast<uint64_t>(num_chunks);

    double *d_totals = nullptr;
    double *d_head = nullptr;
    check_cuda(cudaMalloc(&d_totals, static_cast<size_t>(num_chunks) * sizeof(double)), "cudaMalloc totals");
    check_cuda(cudaMalloc(&d_head, sizeof(double)), "cudaMalloc head");

    cudaStream_t stream_head{};
    cudaStream_t stream_tail{};
    check_cuda(cudaStreamCreate(&stream_head), "cudaStreamCreate head");
    check_cuda(cudaStreamCreate(&stream_tail), "cudaStreamCreate tail");

    harmonic_head_kernel<<<1, 1, 0, stream_head>>>(d_head, head_end);

    constexpr int threads_per_block = 256;
    const int blocks = (num_chunks + threads_per_block - 1) / threads_per_block;
    harmonic_tail_kernel<<<blocks, threads_per_block, 0, stream_tail>>>(
        tail_start, tail_chunk_size, total_end, num_chunks, d_totals);

    check_cuda(cudaStreamSynchronize(stream_head), "sync head stream");
    check_cuda(cudaStreamSynchronize(stream_tail), "sync tail stream");
    check_cuda(cudaMemcpy(&head_sum, d_head, sizeof(double), cudaMemcpyDeviceToHost), "head memcpy");

    cudaStreamDestroy(stream_head);
    cudaStreamDestroy(stream_tail);

    std::vector<double> h_totals(static_cast<size_t>(num_chunks));
    check_cuda(
        cudaMemcpy(h_totals.data(), d_totals, static_cast<size_t>(num_chunks) * sizeof(double), cudaMemcpyDeviceToHost),
        "cudaMemcpy totals");
    cudaFree(d_totals);
    cudaFree(d_head);

    for (int i = 0; i < num_chunks; ++i)
        if (!cfg.quiet)
            std::cout << "tail chunk " << i << ": " << h_totals[static_cast<size_t>(i)] << std::endl;

    const double tail_total = merge_chunks_host(h_totals, SumMode::Turbo);
    double final_sum = 0.0;
    double final_comp = 0.0;
    kahan_add(final_sum, final_comp, head_sum);
    kahan_add(final_sum, final_comp, tail_total);

    stats.final_sum = final_sum;
    stats.terms_processed = total_end;
    return true;
}

} // namespace

bool cuda_is_available()
{
    int count = 0;
    return cudaGetDeviceCount(&count) == cudaSuccess && count > 0;
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

    cudaDeviceProp prop{};
    check_cuda(cudaGetDeviceProperties(&prop, cfg.cuda_device), "cudaGetDeviceProperties");

    const int num_chunks = static_cast<int>(resolve_worker_count(cfg));
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    const uint64_t total_end = static_cast<uint64_t>(num_chunks) * chunk_size;
    const SumMode mode = resolve_sum_mode(cfg);
    const int sum_mode_int = static_cast<int>(mode);

    std::cout << "Backend: CUDA\n";
    std::cout << "Device: " << prop.name << " (SM " << prop.major << "." << prop.minor << ")\n";
    std::cout << "Chunks: " << num_chunks << "  chunk size: " << chunk_size
              << "  sum-mode: " << sum_mode_name(mode);
    if (uses_turbo_cuda_path(mode))
        std::cout << "  [split-head + tail kernel]";
    std::cout << "\n";

    const auto t0 = std::chrono::steady_clock::now();

    if (uses_turbo_cuda_path(mode))
    {
        if (!run_cuda_turbo(cfg, stats, num_chunks, chunk_size, total_end))
            return false;
    }
    else
    {
        double *d_totals = nullptr;
        int *d_errors = nullptr;
        check_cuda(cudaMalloc(&d_totals, static_cast<size_t>(num_chunks) * sizeof(double)), "cudaMalloc totals");
        check_cuda(cudaMalloc(&d_errors, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMalloc errors");
        check_cuda(cudaMemset(d_errors, 0, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMemset errors");

        constexpr int threads_per_block = 256;
        const int blocks = (num_chunks + threads_per_block - 1) / threads_per_block;

        harmonic_chunk_kernel<<<blocks, threads_per_block>>>(
            chunk_size, num_chunks, sum_mode_int, d_totals, d_errors);
        check_cuda(cudaGetLastError(), "harmonic_chunk_kernel launch");
        check_cuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize");

        std::vector<double> h_totals(static_cast<size_t>(num_chunks));
        std::vector<int> h_errors(static_cast<size_t>(num_chunks));
        check_cuda(cudaMemcpy(h_totals.data(), d_totals, static_cast<size_t>(num_chunks) * sizeof(double),
                        cudaMemcpyDeviceToHost), "cudaMemcpy totals");
        check_cuda(cudaMemcpy(h_errors.data(), d_errors, static_cast<size_t>(num_chunks) * sizeof(int),
                        cudaMemcpyDeviceToHost), "cudaMemcpy errors");
        cudaFree(d_totals);
        cudaFree(d_errors);

        for (int i = 0; i < num_chunks; ++i)
        {
            if (h_errors[static_cast<size_t>(i)] != 0)
            {
                std::cerr << "CUDA chunk " << i << " overflowed partial buffer\n";
                return false;
            }
            if (!cfg.quiet)
                std::cout << "chunk " << i << ": " << h_totals[static_cast<size_t>(i)] << std::endl;
        }

        stats.final_sum = merge_chunks_host(h_totals, mode);
        stats.terms_processed = total_end;
    }

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
