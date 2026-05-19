#pragma once

#include "harmonic_config.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace harmonic {

struct RunStats {
    double elapsed_sec = 0.0;
    uint64_t terms_processed = 0;
    double final_sum = 0.0;
    std::string gpu_name;
};

bool run_cpu(const Config &cfg, RunStats &stats);
bool run_cuda(const Config &cfg, RunStats &stats);
bool run_cuda_index_range(const Config &cfg, RunStats &stats, uint64_t range_start, uint64_t range_end);
bool cuda_is_available();

} // namespace harmonic
