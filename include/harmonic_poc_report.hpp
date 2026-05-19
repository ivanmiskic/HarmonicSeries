#pragma once

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_runner.hpp"

#include <cmath>
#include <iostream>
#include <iomanip>

namespace harmonic {

inline void print_poc_scaling_report(const Config &cfg, const RunStats &stats)
{
    if (stats.elapsed_sec <= 0.0 || stats.terms_processed == 0)
        return;

    const double terms_per_sec = static_cast<double>(stats.terms_processed) / stats.elapsed_sec;
    const double sec_per_gpu = TARGET_N_SUM_40 / terms_per_sec;
    const double gpus_for_one_day = sec_per_gpu / 86400.0;

    std::cout << "\n--- POC scaling (H_n = 40, brute-force estimate) ---\n";
    std::cout << std::fixed << std::setprecision(6);
    std::cout << "Mode: " << sum_mode_name(resolve_sum_mode(cfg)) << "\n";
    std::cout << std::setprecision(3);
    std::cout << "Terms/s (this run):     " << terms_per_sec << "\n";
    std::cout << "Target n:               " << std::scientific << TARGET_N_SUM_40 << std::fixed << "\n";
    std::cout << "1 GPU time to n:        " << (sec_per_gpu / 86400.0) << " days ("
              << (sec_per_gpu / 31557600.0) << " years)\n";
    std::cout << "GPUs for 1 day (ideal): " << gpus_for_one_day << " (same class as this run)\n";
    std::cout << "Cloud $ rough (@$0.35/GPU/hr): $" << (gpus_for_one_day * 24.0 * 0.35) << " / day\n";
    std::cout << "Note: use --sum-mode turbo on CUDA for best throughput toward huge n.\n";
}

inline void validate_sum_modes(uint64_t start, uint64_t end)
{
    double a = 0, s = 0, f = 0, ad = 0;
    sum_chunk_range(start, end, SumMode::Accurate, a);
    sum_chunk_range(start, end, SumMode::Standard, s);
    sum_chunk_range(start, end, SumMode::Fast, f);
    double t = 0;
    sum_chunk_range(start, end, SumMode::Adaptive, ad);
    sum_chunk_range(start, end, SumMode::Turbo, t);

    std::cout << std::fixed << std::setprecision(15);
    std::cout << "Validation [" << start << ".." << end << "]:\n";
    std::cout << "  accurate:  " << a << "\n";
    std::cout << "  standard:  " << s << "  err vs accurate: " << (s - a) << "\n";
    std::cout << "  fast:      " << f << "  err vs accurate: " << (f - a) << "\n";
    std::cout << "  adaptive:  " << ad << "  err vs accurate: " << (ad - a) << "\n";
    std::cout << "  turbo:     " << t << "  err vs accurate: " << (t - a) << "\n";
}

} // namespace harmonic
