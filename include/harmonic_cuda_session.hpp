#pragma once

#include "harmonic_config.hpp"

#include <cstdint>
#include <string>

namespace harmonic {

struct RunStats;

/** Persistent GPU allocations for repeated index-range runs (distributed work units). */
struct CudaSession {
    int num_chunks = 0;
    int cuda_device = -1;
    double *d_head = nullptr;
    double *d_totals = nullptr;
    double *d_reduced = nullptr;
    int *d_errors = nullptr;
    bool ready = false;
};

bool cuda_session_init(CudaSession &session, const Config &cfg, std::string &gpu_name);
void cuda_session_fini(CudaSession &session);

bool cuda_session_run_range(
    CudaSession &session,
    const Config &cfg,
    RunStats &stats,
    uint64_t range_start,
    uint64_t range_end,
    bool verbose = false);

} // namespace harmonic
