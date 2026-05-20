#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

struct Config;
bool parse_args(int argc, char **argv, Config &cfg, std::vector<std::string> *merge_files = nullptr);

#include "harmonic_core.hpp"

#include <cstring>
#include <iostream>
#include <thread>

enum class Backend {
    Cpu,
    Cuda,
    Estimate,
};

enum class OutputFormat {
    Text,
    Json,
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
    bool sum_mode_explicit = false;
    harmonic::SumMode sum_mode = harmonic::SumMode::Adaptive;
    double target_sum = 40.0;
    uint64_t verify_window = 0;
    uint64_t validate_range = 0;
    int cuda_device = 0;
    OutputFormat output_format = OutputFormat::Text;
    bool progress_json = false;
    bool list_gpus = false;

    // Distributed multi-machine
    bool distributed = false;
    int dist_rank = 0;
    int dist_nodes = 1;
    uint64_t global_n = 0;
    std::string out_file;
    std::string sync_leader_host;
    int sync_port = 19660;
    bool dist_dynamic = true;
    uint64_t work_unit = 0;
};

constexpr size_t DEFAULT_CUDA_CHUNKS = 8192;
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
        << "  adaptive   compensated for i<1e6, Kahan above\n"
        << "  turbo      split head + unrolled tail CUDA kernel (default on CUDA)\n\n"
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
        << "  --format json|text  Output format (default: text)\n"
        << "  --progress-json     Emit NDJSON progress on stderr\n"
        << "  --list-gpus         List CUDA devices as JSON and exit\n"
        << "  --global-n N        Bound summation to [1..N] (single-machine or distributed)\n"
        << "Distributed (multi-machine):\n"
        << "  --distributed R:N   This machine is rank R of N (e.g. 0:2)\n"
        << "  --global-n N        Total index n for H_n (all nodes same value)\n"
        << "  --out FILE          Write partial result for merge step\n"
        << "  --sync-leader HOST  IP of rank-0 machine (required on rank>0)\n"
        << "  --sync-port PORT    TCP barrier port (default: 19660)\n"
        << "  --dist-schedule S   static (50/50 split) or dynamic (default, load-balanced)\n"
        << "  --work-unit N       Dynamic: index span per work unit (default: 200M)\n"
        << "  --merge-results F…  Merge node result files and exit\n"
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
    else if (value == "turbo")
        mode = harmonic::SumMode::Turbo;
    else
        return false;
    return true;
}

inline bool parse_distributed_spec(const char *spec, int &rank, int &nodes)
{
    const std::string s(spec);
    const size_t colon = s.find(':');
    if (colon == std::string::npos)
        return false;
    rank = static_cast<int>(std::stoi(s.substr(0, colon)));
    nodes = static_cast<int>(std::stoi(s.substr(colon + 1)));
    return nodes > 0 && rank >= 0 && rank < nodes;
}

inline bool parse_args(int argc, char **argv, Config &cfg, std::vector<std::string> *merge_files)
{
    for (int i = 1; i < argc; ++i)
    {
        if (std::strcmp(argv[i], "--merge-results") == 0)
        {
            if (!merge_files)
            {
                std::cerr << "Internal error: merge_files output not provided\n";
                return false;
            }
            merge_files->clear();
            while (i + 1 < argc && argv[i + 1][0] != '-')
                merge_files->emplace_back(argv[++i]);
            if (merge_files->empty())
            {
                std::cerr << "--merge-results requires at least one file\n";
                return false;
            }
            continue;
        }
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
        if (std::strcmp(argv[i], "--progress-json") == 0)
        {
            cfg.progress_json = true;
            continue;
        }
        if (std::strcmp(argv[i], "--list-gpus") == 0)
        {
            cfg.list_gpus = true;
            continue;
        }
        if (std::strcmp(argv[i], "--format") == 0)
        {
            if (i + 1 >= argc)
            {
                std::cerr << "Missing value for --format\n";
                return false;
            }
            const std::string value = argv[++i];
            if (value == "json")
                cfg.output_format = OutputFormat::Json;
            else if (value == "text")
                cfg.output_format = OutputFormat::Text;
            else
            {
                std::cerr << "Unknown --format (use json or text)\n";
                return false;
            }
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
                std::cerr << "Unknown --sum-mode (use accurate, standard, fast, adaptive, turbo)\n";
                return false;
            }
            cfg.sum_mode_explicit = true;
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
        if (std::strcmp(argv[i], "--distributed") == 0)
        {
            if (!parse_distributed_spec(argv[++i], cfg.dist_rank, cfg.dist_nodes))
            {
                std::cerr << "Invalid --distributed (use R:N e.g. 0:2)\n";
                return false;
            }
            cfg.distributed = true;
            continue;
        }
        if (std::strcmp(argv[i], "--global-n") == 0)
        {
            cfg.global_n = static_cast<uint64_t>(std::stoull(argv[++i]));
            continue;
        }
        if (std::strcmp(argv[i], "--out") == 0)
        {
            cfg.out_file = argv[++i];
            continue;
        }
        if (std::strcmp(argv[i], "--sync-leader") == 0)
        {
            cfg.sync_leader_host = argv[++i];
            continue;
        }
        if (std::strcmp(argv[i], "--sync-port") == 0)
        {
            cfg.sync_port = std::stoi(argv[++i]);
            continue;
        }
        if (std::strcmp(argv[i], "--dist-schedule") == 0)
        {
            const std::string v = argv[++i];
            if (v == "dynamic")
                cfg.dist_dynamic = true;
            else if (v == "static")
                cfg.dist_dynamic = false;
            else
            {
                std::cerr << "Unknown --dist-schedule (use static or dynamic)\n";
                return false;
            }
            continue;
        }
        if (std::strcmp(argv[i], "--work-unit") == 0)
        {
            cfg.work_unit = static_cast<uint64_t>(std::stoull(argv[++i]));
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

inline harmonic::SumMode resolve_sum_mode(const Config &cfg)
{
    if (cfg.sum_mode_explicit)
        return cfg.sum_mode;
    if (cfg.backend == Backend::Cuda)
        return harmonic::SumMode::Turbo;
    return harmonic::SumMode::Adaptive;
}

inline uint64_t resolve_work_unit(const Config &cfg)
{
    if (cfg.work_unit > 0)
        return cfg.work_unit;
    return 200000000U;
}

inline uint64_t resolve_global_end(const Config &cfg)
{
    if (cfg.global_n > 0)
        return cfg.global_n;
    const size_t workers = resolve_worker_count(cfg);
    const uint64_t chunk_size = resolve_chunk_size(cfg);
    return static_cast<uint64_t>(workers) * chunk_size;
}
