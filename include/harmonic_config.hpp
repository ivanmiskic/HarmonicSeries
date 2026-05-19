#pragma once

#include "harmonic_core.hpp"

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

enum class Backend {
    Cpu,
    Cuda,
    Estimate,
};

struct Config {
    Backend backend = Backend::Cpu;
    uint64_t chunk_size = 100000000U;
    size_t worker_count = 0;
    bool chunk_size_explicit = false;
    bool worker_count_explicit = false;
    bool show_progress = true;
    bool quiet = false;
    bool fast_math = false;
    bool poc_report = false;
    harmonic::SumMode sum_mode = harmonic::SumMode::Adaptive;
    double target_sum = 40.0;
    uint64_t verify_window = 0;
    uint64_t validate_range = 0;
    int cuda_device = 0;
};

constexpr size_t DEFAULT_CUDA_CHUNKS = 4096;
constexpr uint64_t DEFAULT_CUDA_CHUNK_SIZE = 156250U;

inline void print_usage(const char *prog)
{
    std::cerr
        << "Harmonic series partial-sum calculator\n\n"
        << "Usage: " << prog << " [options]\n\n"
        << "Backends:\n"
        << "  --backend cpu       Multi-threaded CPU (default)\n"
        << "  --backend cuda      One GPU thread per chunk\n"
        << "  --backend estimate  Euler-Maclaurin n for target sum (instant)\n\n"
        << "Sum modes (--sum-mode):\n"
        << "  accurate   div + compensated partials (slowest, reference)\n"
        << "  standard   inv recurrence + compensated (no div in loop)\n"
        << "  fast       inv recurrence + Kahan per chunk\n"
        << "  adaptive   compensated for i<1e6, Kahan above (default, best for huge n)\n\n"
        << "Options:\n"
        << "  --chunk-size N      Terms per chunk (CUDA default: " << DEFAULT_CUDA_CHUNK_SIZE << ")\n"
        << "  --threads N         Workers (CPU: HW cores, CUDA default: " << DEFAULT_CUDA_CHUNKS << ")\n"
        << "  --target S          Target harmonic sum for estimate mode (default: 40)\n"
        << "  --verify-window W   After estimate, direct-sum verify n+-W (0=skip)\n"
        << "  --validate-range N  Compare sum modes on [1..N] and exit\n"
        << "  --poc-report        Print GPUs/day and cost scaling for sum=40\n"
        << "  --cuda-device ID    CUDA device index (default: 0)\n"
        << "  --no-progress       Disable CPU progress thread\n"
        << "  --quiet             Suppress per-chunk output\n"
        << "  --fast-math         CUDA: enable --use_fast_math (rebuild FAST_MATH=1)\n"
        << "  --help              Show this help\n";
}

inline bool parse_sum_mode(const std::string &value, harmonic::SumMode &mode)
{
    if (value == "accurate")
        mode = harmonic::SumMode::Accurate;
    else if (value == "standard")
        mode = harmonic::SumMode::Standard;
    else if (value == "fast")
        mode = harmonic::SumMode::Fast;
    else if (value == "adaptive")
        mode = harmonic::SumMode::Adaptive;
    else
        return false;
    return true;
}

inline bool parse_args(int argc, char **argv, Config &cfg)
{
    for (int i = 1; i < argc; ++i)
    {
        if (std::strcmp(argv[i], "--help") == 0)
        {
            print_usage(argv[0]);
            return false;
        }
        if (std::strcmp(argv[i], "--no-progress") == 0)
        {
            cfg.show_progress = false;
            continue;
        }
        if (std::strcmp(argv[i], "--quiet") == 0)
        {
            cfg.quiet = true;
            continue;
        }
        if (std::strcmp(argv[i], "--fast-math") == 0)
        {
            cfg.fast_math = true;
            continue;
        }
        if (std::strcmp(argv[i], "--poc-report") == 0)
        {
            cfg.poc_report = true;
            continue;
        }
        if (std::strcmp(argv[i], "--backend") == 0)
        {
            if (i + 1 >= argc)
            {
                std::cerr << "Missing value for --backend\n";
                return false;
            }
            const std::string value = argv[++i];
            if (value == "cpu")
                cfg.backend = Backend::Cpu;
            else if (value == "cuda")
                cfg.backend = Backend::Cuda;
            else if (value == "estimate")
                cfg.backend = Backend::Estimate;
            else
            {
                std::cerr << "Unknown backend: " << value << "\n";
                return false;
            }
            continue;
        }
        if (std::strcmp(argv[i], "--sum-mode") == 0)
        {
            if (i + 1 >= argc)
            {
                std::cerr << "Missing value for --sum-mode\n";
                return false;
            }
            if (!parse_sum_mode(argv[++i], cfg.sum_mode))
            {
                std::cerr << "Unknown --sum-mode (use accurate, standard, fast, adaptive)\n";
                return false;
            }
            continue;
        }
        if (i + 1 >= argc)
        {
            std::cerr << "Missing value for " << argv[i] << "\n";
            return false;
        }
        if (std::strcmp(argv[i], "--chunk-size") == 0)
        {
            cfg.chunk_size = static_cast<uint64_t>(std::stoull(argv[++i]));
            cfg.chunk_size_explicit = true;
            if (cfg.chunk_size == 0)
            {
                std::cerr << "--chunk-size must be > 0\n";
                return false;
            }
            continue;
        }
        if (std::strcmp(argv[i], "--threads") == 0)
        {
            cfg.worker_count = static_cast<size_t>(std::stoull(argv[++i]));
            cfg.worker_count_explicit = true;
            if (cfg.worker_count == 0)
            {
                std::cerr << "--threads must be > 0\n";
                return false;
            }
            continue;
        }
        if (std::strcmp(argv[i], "--target") == 0)
        {
            cfg.target_sum = std::stod(argv[++i]);
            continue;
        }
        if (std::strcmp(argv[i], "--verify-window") == 0)
        {
            cfg.verify_window = static_cast<uint64_t>(std::stoull(argv[++i]));
            continue;
        }
        if (std::strcmp(argv[i], "--validate-range") == 0)
        {
            cfg.validate_range = static_cast<uint64_t>(std::stoull(argv[++i]));
            continue;
        }
        if (std::strcmp(argv[i], "--cuda-device") == 0)
        {
            cfg.cuda_device = std::stoi(argv[++i]);
            continue;
        }
        std::cerr << "Unknown option: " << argv[i] << "\n";
        print_usage(argv[0]);
        return false;
    }
    return true;
}

inline size_t default_cpu_worker_count()
{
    const unsigned int hw = std::thread::hardware_concurrency();
    return hw > 0 ? static_cast<size_t>(hw) : 1U;
}

inline size_t resolve_worker_count(const Config &cfg)
{
    if (cfg.worker_count_explicit && cfg.worker_count > 0)
        return cfg.worker_count;
    if (cfg.backend == Backend::Cuda)
        return DEFAULT_CUDA_CHUNKS;
    return default_cpu_worker_count();
}

inline uint64_t resolve_chunk_size(const Config &cfg)
{
    if (cfg.chunk_size_explicit)
        return cfg.chunk_size;
    if (cfg.backend == Backend::Cuda)
        return DEFAULT_CUDA_CHUNK_SIZE;
    return cfg.chunk_size;
}
