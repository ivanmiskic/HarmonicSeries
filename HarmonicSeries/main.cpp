#define _CRT_SECURE_NO_WARNINGS

#include "harmonic_config.hpp"
#include "harmonic_estimator.hpp"
#include "harmonic_runner.hpp"

#include <iostream>

int main(int argc, char **argv)
{
    Config cfg;
    if (!parse_args(argc, argv, cfg))
        return 1;

    if (cfg.backend == Backend::Estimate)
    {
        harmonic::run_estimate_mode(cfg);
        return 0;
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
