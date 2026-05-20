#pragma once

#include "harmonic_config.hpp"
#include "harmonic_core.hpp"
#include "harmonic_runner.hpp"

#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

namespace harmonic {

struct PocMetrics {
    double terms_per_sec = 0.0;
    double target_n_sum_40 = TARGET_N_SUM_40;
    double sec_per_gpu = 0.0;
    double days_per_gpu = 0.0;
    double years_per_gpu = 0.0;
    double gpus_for_one_day = 0.0;
    double cloud_usd_per_day_at_0_35 = 0.0;
    bool valid = false;
};

inline PocMetrics build_poc_metrics(const RunStats &stats)
{
    PocMetrics m{};
    if (stats.elapsed_sec <= 0.0 || stats.terms_processed == 0)
        return m;

    m.terms_per_sec = static_cast<double>(stats.terms_processed) / stats.elapsed_sec;
    m.sec_per_gpu = TARGET_N_SUM_40 / m.terms_per_sec;
    m.days_per_gpu = m.sec_per_gpu / 86400.0;
    m.years_per_gpu = m.sec_per_gpu / 31557600.0;
    m.gpus_for_one_day = m.sec_per_gpu / 86400.0;
    m.cloud_usd_per_day_at_0_35 = m.gpus_for_one_day * 24.0 * 0.35;
    m.valid = true;
    return m;
}

inline void print_poc_scaling_report(const Config &cfg, const RunStats &stats)
{
    const PocMetrics m = build_poc_metrics(stats);
    if (!m.valid)
        return;

    std::cout << "\n--- POC scaling (H_n = 40, brute-force estimate) ---\n";
    std::cout << std::fixed;
    std::cout << std::setprecision(6);
    std::cout << "Mode: " << sum_mode_name(resolve_sum_mode(cfg)) << "\n";
    std::cout << std::setprecision(3);
    std::cout << "Terms/s (this run):     " << m.terms_per_sec << "\n";
    std::cout << "Target n:               " << std::scientific << m.target_n_sum_40 << std::fixed << "\n";
    std::cout << "1 GPU time to n:        " << m.days_per_gpu << " days (" << m.years_per_gpu << " years)\n";
    std::cout << "GPUs for 1 day (ideal): " << m.gpus_for_one_day << " (same class as this run)\n";
    std::cout << "Cloud $ rough (@$0.35/GPU/hr): $" << m.cloud_usd_per_day_at_0_35 << " / day\n";
    std::cout << "Note: use --sum-mode turbo on CUDA for best throughput toward huge n.\n";
}

inline std::string json_escape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s)
    {
        switch (c)
        {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        default:
            out += c;
            break;
        }
    }
    return out;
}

inline std::string backend_name(Backend b)
{
    switch (b)
    {
    case Backend::Cpu:
        return "cpu";
    case Backend::Cuda:
        return "cuda";
    case Backend::Estimate:
        return "estimate";
    }
    return "unknown";
}

inline void append_poc_json(std::ostringstream &oss, const PocMetrics &m)
{
    oss << ",\"poc\":{";
    if (m.valid)
    {
        oss << std::scientific;
        oss << "\"terms_per_sec\":" << m.terms_per_sec;
        oss << ",\"target_n_sum_40\":" << m.target_n_sum_40;
        oss << ",\"sec_per_gpu\":" << m.sec_per_gpu;
        oss << ",\"days_per_gpu\":" << m.days_per_gpu;
        oss << ",\"years_per_gpu\":" << m.years_per_gpu;
        oss << ",\"gpus_for_one_day\":" << m.gpus_for_one_day;
        oss << ",\"cloud_usd_per_day_at_0_35\":" << m.cloud_usd_per_day_at_0_35;
        oss << std::fixed;
    }
    else
    {
        oss << "\"valid\":false";
    }
    oss << "}";
}

inline void print_run_result_json(const Config &cfg, const RunStats &stats, bool include_poc)
{
    const double terms_per_sec =
        stats.elapsed_sec > 0.0 ? static_cast<double>(stats.terms_processed) / stats.elapsed_sec : 0.0;
    PocMetrics poc{};
    if (include_poc)
        poc = build_poc_metrics(stats);

    std::ostringstream oss;
    oss << std::fixed;
    oss << "{";
    oss << "\"backend\":\"" << backend_name(cfg.backend) << "\"";
    oss << ",\"sum_mode\":\"" << sum_mode_name(resolve_sum_mode(cfg)) << "\"";
    oss << ",\"chunk_size\":" << resolve_chunk_size(cfg);
    oss << ",\"threads\":" << resolve_worker_count(cfg);
    oss << ",\"global_n\":";
    if (cfg.global_n > 0)
        oss << cfg.global_n;
    else
        oss << "null";
    oss << ",\"terms_processed\":" << stats.terms_processed;
    oss << std::setprecision(15);
    oss << ",\"elapsed_sec\":" << stats.elapsed_sec;
    oss << ",\"terms_per_sec\":" << terms_per_sec;
    oss << ",\"final_sum\":" << stats.final_sum;
    oss << ",\"gpu_name\":\"" << json_escape(stats.gpu_name) << "\"";
    if (include_poc)
        append_poc_json(oss, poc);
    oss << "}";
    std::cout << oss.str() << std::endl;
}

inline void emit_progress_json(
    double partial_sum,
    double elapsed_sec,
    uint64_t terms_done,
    uint64_t global_n)
{
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(15);
    oss << "{\"type\":\"progress\"";
    oss << ",\"partial_sum\":" << partial_sum;
    oss << ",\"elapsed_sec\":" << elapsed_sec;
    oss << ",\"terms_done\":" << terms_done;
    if (global_n > 0)
        oss << ",\"global_n\":" << global_n;
    oss << "}";
    std::cerr << oss.str() << std::endl;
}

inline bool is_json_output(const Config &cfg)
{
    return cfg.output_format == OutputFormat::Json;
}

} // namespace harmonic
