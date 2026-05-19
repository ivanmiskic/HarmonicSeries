#pragma once

#include "harmonic_config.hpp"
#include "harmonic_runner.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace harmonic {

struct IndexRange {
    uint64_t start = 1;
    uint64_t end = 0;
    uint64_t term_count = 0;
};

struct NodeResult {
    int rank = 0;
    int nodes = 1;
    uint64_t range_start = 1;
    uint64_t range_end = 0;
    uint64_t terms_processed = 0;
    uint64_t work_units_done = 0;
    double partial_sum = 0.0;
    double elapsed_sec = 0.0;
    std::string schedule;
    std::string hostname;
    std::string gpu_name;
};

struct WorkUnitRange {
    int64_t unit_id = -1;
    uint64_t start = 0;
    uint64_t end = 0;
};

uint64_t total_work_units(uint64_t global_n, uint64_t work_unit);
bool work_unit_to_range(int64_t unit_id, uint64_t work_unit, uint64_t global_n, WorkUnitRange &out);

// Equal term-count partition of [1 .. global_n] across nodes.
IndexRange partition_range(int rank, int nodes, uint64_t global_n);

// Rank 0 listens; ranks > 0 connect to leader_host. Barrier then all proceed.
bool distributed_sync_barrier(int rank, int nodes, const std::string &leader_host, int port);

bool write_node_result(const std::string &path, const NodeResult &result);
bool read_node_result(const std::string &path, NodeResult &result);

bool merge_node_results(const std::vector<std::string> &paths, double &out_total, uint64_t &out_terms);

bool run_distributed_cuda(const Config &cfg, RunStats &stats);
bool run_merge_mode(const std::vector<std::string> &result_files);

} // namespace harmonic
