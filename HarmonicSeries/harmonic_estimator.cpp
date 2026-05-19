#include "harmonic_estimator.hpp"

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"

#include <cmath>
#include <iostream>
#include <iomanip>

namespace harmonic {

uint64_t estimate_n_for_target_sum(double target, int iterations)
{
    double n = std::exp(target - EULER_GAMMA);
    if (n < 2.0)
        n = 2.0;

    for (int i = 0; i < iterations; ++i)
    {
        const double inv_n = 1.0 / n;
        const double inv_n2 = inv_n * inv_n;
        const double f = std::log(n) + EULER_GAMMA + 0.5 * inv_n - inv_n2 / 12.0 - target;
        const double df = inv_n - 0.5 * inv_n2 + inv_n2 * inv_n / 6.0;
        n -= f / df;
        if (n < 2.0)
            n = 2.0;
    }

    return static_cast<uint64_t>(std::llround(n));
}

bool harmonic_at_index(uint64_t n, double &out_sum)
{
    if (n == 0)
        return false;
    return sum_chunk_range(1, n, out_sum);
}

void run_estimate_mode(const Config &cfg)
{
    const uint64_t n_est = estimate_n_for_target_sum(cfg.target_sum);
    const double approx = harmonic_approx(static_cast<double>(n_est));

    std::cout << std::fixed << std::setprecision(15);
    std::cout << "Target sum H_n = " << cfg.target_sum << "\n";
    std::cout << "Estimated n (Euler-Maclaurin): " << n_est << "\n";
    std::cout << "Approximate H_n at estimate: " << approx << "\n";
    std::cout << "Error vs target: " << (approx - cfg.target_sum) << "\n";

    if (cfg.verify_window == 0)
        return;

    std::cout << "\nVerification window ±" << cfg.verify_window << " (direct compensated sum):\n";
    const uint64_t from = (n_est > cfg.verify_window) ? n_est - cfg.verify_window : 1U;
    const uint64_t to = n_est + cfg.verify_window;

    for (uint64_t n = from; n <= to; ++n)
    {
        double value = 0.0;
        if (!harmonic_at_index(n, value))
        {
            std::cerr << "Verification failed at n=" << n << " (partial list overflow)\n";
            return;
        }
        const char marker = (n == n_est) ? '*' : ' ';
        std::cout << marker << " n=" << n << "  H_n=" << value
                  << "  delta=" << (value - cfg.target_sum) << "\n";
    }
}

} // namespace harmonic
