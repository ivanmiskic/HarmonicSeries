#define _CRT_SECURE_NO_WARNINGS

#include "harmonic_config.hpp"
#include "harmonic_distributed.hpp"
#include "harmonic_estimator.hpp"
#include "harmonic_poc_report.hpp"
#include "harmonic_runner.hpp"

#include <iostream>

int main(int argc, char **argv)
{
    Config cfg;
    std::vector<std::string> merge_files;
    if (!parse_args(argc, argv, cfg, &merge_files))
        return 1;

    if (!merge_files.empty())
        return harmonic::run_merge_mode(merge_files) ? 0 : 1;

    if (cfg.validate_range > 0)
    {
        harmonic::validate_sum_modes(1, cfg.validate_range);
        return 0;
    }

    if (cfg.backend == Backend::Estimate)
    {
        harmonic::run_estimate_mode(cfg);
        return 0;
    }

    if (cfg.distributed)
    {
        if (cfg.global_n == 0)
        {
            std::cerr << "Distributed mode requires --global-n N (same on all machines)\n";
            return 1;
        }
        if (cfg.backend != Backend::Cuda)
        {
            std::cerr << "Distributed mode currently requires --backend cuda\n";
            return 1;
        }
        if (cfg.out_file.empty())
        {
            std::cerr << "Warning: --out not set; use e.g. --out rank" << cfg.dist_rank << ".txt\n";
        }
        harmonic::RunStats stats;
        return harmonic::run_distributed_cuda(cfg, stats) ? 0 : 1;
    }

    harmonic::RunStats stats;
    bool ok = false;

    if (cfg.backend == Backend::Cuda)
    {
        if (!harmonic::cuda_is_available())
        {
            std::cerr << "CUDA is not available on this system.\n";
            return 1;
        }
        ok = harmonic::run_cuda(cfg, stats);
    }
    else
    {
        ok = harmonic::run_cpu(cfg, stats);
    }

    return ok ? 0 : 1;
}
