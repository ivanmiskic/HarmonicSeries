#pragma once

#include "harmonic_core.hpp"

#include <cmath>
#include <cstdint>

struct Config;

namespace harmonic {

constexpr double EULER_GAMMA = 0.57721566490153286060651209008240243104215933593992;

// H(n) ≈ ln(n) + γ + 1/(2n) - 1/(12 n²)
inline double harmonic_approx(double n)
{
    const double ln_n = std::log(n);
    const double inv_n = 1.0 / n;
    return ln_n + EULER_GAMMA + 0.5 * inv_n - inv_n * inv_n / 12.0;
}

// Solve harmonic_approx(n) = target via Newton iterations.
uint64_t estimate_n_for_target_sum(double target, int iterations = 12);

// Direct compensated sum for H_n at a single index (small/medium n only).
bool harmonic_at_index(uint64_t n, double &out_sum, SumMode mode = SumMode::Accurate);

void run_estimate_mode(const Config &cfg);

} // namespace harmonic
