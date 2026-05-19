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

__global__ void __launch_bounds__(256, 4) harmonic_chunk_kernel(
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
    {
        error_flags[idx] = 1;
        return;
    }

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

bool cuda_is_available()
{
    int count = 0;
    if (cudaGetDeviceCount(&count) != cudaSuccess || count == 0)
        return false;
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
        std::cerr << "Invalid --cuda-device " << cfg.cuda_device << " (found " << device_count << ")\n";
        return false;
    }

    check_cuda(cudaSetDevice(cfg.cuda_device), "cudaSetDevice");

    cudaDeviceProp prop{};
    check_cuda(cudaGetDeviceProperties(&prop, cfg.cuda_device), "cudaGetDeviceProperties");

    const int num_chunks = static_cast<int>(resolve_worker_count(cfg));
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    const int sum_mode_int = static_cast<int>(cfg.sum_mode);

    std::cout << "Backend: CUDA\n";
    std::cout << "Device: " << prop.name << " (SM " << prop.major << "." << prop.minor << ")\n";
    std::cout << "Chunks: " << num_chunks << "  chunk size: " << chunk_size
              << "  sum-mode: " << sum_mode_name(cfg.sum_mode);
#ifdef HARMONIC_FAST_MATH
    if (cfg.fast_math)
        std::cout << "  [fast-math: on]";
#else
    if (cfg.fast_math)
        std::cerr << "\nWarning: --fast-math ignored; rebuild with: make CUDA=1 FAST_MATH=1\n";
#endif
    std::cout << "\n";

    double *d_totals = nullptr;
    int *d_errors = nullptr;
    check_cuda(cudaMalloc(&d_totals, static_cast<size_t>(num_chunks) * sizeof(double)), "cudaMalloc totals");
    check_cuda(cudaMalloc(&d_errors, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMalloc errors");
    check_cuda(cudaMemset(d_errors, 0, static_cast<size_t>(num_chunks) * sizeof(int)), "cudaMemset errors");

    constexpr int threads_per_block = 256;
    const int blocks = (num_chunks + threads_per_block - 1) / threads_per_block;

    const auto t0 = std::chrono::steady_clock::now();
    harmonic_chunk_kernel<<<blocks, threads_per_block>>>(
        chunk_size,
        num_chunks,
        sum_mode_int,
        d_totals,
        d_errors);
    check_cuda(cudaGetLastError(), "harmonic_chunk_kernel launch");
    check_cuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize");

    std::vector<double> h_totals(static_cast<size_t>(num_chunks));
    std::vector<int> h_errors(static_cast<size_t>(num_chunks));
    check_cuda(
        cudaMemcpy(h_totals.data(), d_totals, static_cast<size_t>(num_chunks) * sizeof(double), cudaMemcpyDeviceToHost),
        "cudaMemcpy totals");
    check_cuda(
        cudaMemcpy(h_errors.data(), d_errors, static_cast<size_t>(num_chunks) * sizeof(int), cudaMemcpyDeviceToHost),
        "cudaMemcpy errors");

    cudaFree(d_totals);
    cudaFree(d_errors);

    const auto t1 = std::chrono::steady_clock::now();
    stats.elapsed_sec = std::chrono::duration<double>(t1 - t0).count();
    stats.terms_processed = static_cast<uint64_t>(num_chunks) * chunk_size;

    for (int i = 0; i < num_chunks; ++i)
    {
        if (h_errors[static_cast<size_t>(i)] != 0)
        {
            std::cerr << "CUDA chunk " << i << " overflowed partial buffer (max " << MAX_PARTIALS << ")\n";
            return false;
        }
        if (!cfg.quiet)
            std::cout << "chunk " << i << ": " << h_totals[static_cast<size_t>(i)] << std::endl;
    }

    stats.final_sum = merge_chunks_host(h_totals, cfg.sum_mode);
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
