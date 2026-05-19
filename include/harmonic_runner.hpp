#pragma once

#include "harmonic_config.hpp"

#include <vector>

namespace harmonic {

struct RunStats {
    double elapsed_sec = 0.0;
    uint64_t terms_processed = 0;
    double final_sum = 0.0;
};

bool run_cpu(const Config &cfg, RunStats &stats);
bool run_cuda(const Config &cfg, RunStats &stats);
bool cuda_is_available();

} // namespace harmonic
