#pragma once

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_output.hpp"

#include <iostream>
#include <iomanip>

namespace harmonic {

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
