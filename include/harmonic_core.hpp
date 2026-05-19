#pragma once

#include <cstdint>

#ifdef __CUDACC__
#define HARMONIC_HD __host__ __device__
#else
#define HARMONIC_HD
#endif

namespace harmonic {

constexpr int MAX_PARTIALS = 64;

// Chunks starting above this index use single Kahan (terms are tiny; partial list rarely needed).
constexpr uint64_t TAIL_KAHAN_THRESHOLD = 1000000ULL;

constexpr double TARGET_N_SUM_40 = 1.32159290357566703e17;

enum class SumMode : int {
    Accurate = 0, // div each step + compensated partials (baseline)
    Standard = 1, // inv recurrence + compensated partials
    Fast = 2,     // inv recurrence + Kahan per chunk
    Adaptive = 3, // compensated below threshold, Kahan at/above (best for huge n)
};

struct PartialState {
    double buf_a[MAX_PARTIALS];
    double buf_b[MAX_PARTIALS];
    double *cur;
    double *next;
    int cur_count;
};

struct ChunkRange {
    uint64_t start;
    uint64_t end;
};

inline HARMONIC_HD ChunkRange chunk_range(uint64_t chunk_index_1based, uint64_t chunk_size)
{
    const uint64_t end = chunk_index_1based * chunk_size;
    const uint64_t start = end - chunk_size + 1;
    return {start, end};
}

inline HARMONIC_HD void partial_clear(PartialState &state)
{
    state.cur = state.buf_a;
    state.next = state.buf_b;
    state.cur_count = 0;
}

inline HARMONIC_HD void kahan_add(double &sum, double &comp, double x)
{
    const double y = x - comp;
    const double t = sum + y;
    comp = (t - sum) - y;
    sum = t;
}

inline HARMONIC_HD bool partial_add_term(PartialState &state, double x)
{
    int next_count = 0;

    for (int i = 0; i < state.cur_count; ++i)
    {
        const double y = state.cur[i];
        double high, low;
        if (x < y)
        {
            high = x + y;
            low = x - (high - y);
        }
        else
        {
            high = x + y;
            low = y - (high - x);
        }

        if (low != 0.0)
        {
            if (next_count >= MAX_PARTIALS)
                return false;
            state.next[next_count++] = low;
        }
        x = high;
    }

    if (next_count >= MAX_PARTIALS)
        return false;
    state.next[next_count++] = x;

    double *const tmp = state.cur;
    state.cur = state.next;
    state.next = tmp;
    state.cur_count = next_count;
    return true;
}

inline HARMONIC_HD double kahan_sum(const double *data, int count)
{
    double compensation = 0.0;
    double sum = 0.0;
    for (int i = count - 1; i >= 0; --i)
    {
        const double x = data[i] - compensation;
        const double y = sum + x;
        compensation = (y - sum) - x;
        sum = y;
    }
    return sum;
}

// 1/(i+1) from 1/i without division: inv *= i/(i+1)
inline HARMONIC_HD void inv_step(uint64_t i, double &inv)
{
    inv *= static_cast<double>(i) / static_cast<double>(i + 1U);
}

inline HARMONIC_HD bool sum_chunk_kahan(
    uint64_t start,
    uint64_t end,
    bool use_recurrence,
    double &out_total)
{
    double sum = 0.0;
    double comp = 0.0;

    if (use_recurrence)
    {
        double inv = 1.0 / static_cast<double>(start);
        for (uint64_t i = start; i <= end; ++i)
        {
            kahan_add(sum, comp, inv);
            if (i < end)
                inv_step(i, inv);
        }
    }
    else
    {
        for (uint64_t i = start; i <= end; ++i)
            kahan_add(sum, comp, 1.0 / static_cast<double>(i));
    }

    out_total = sum;
    return true;
}

inline HARMONIC_HD bool sum_chunk_compensated(
    uint64_t start,
    uint64_t end,
    bool use_recurrence,
    double &out_total)
{
    PartialState state;
    partial_clear(state);

    if (use_recurrence)
    {
        double inv = 1.0 / static_cast<double>(start);
        for (uint64_t i = start; i <= end; ++i)
        {
            if (!partial_add_term(state, inv))
                return false;
            if (i < end)
                inv_step(i, inv);
        }
    }
    else
    {
        for (uint64_t i = start; i <= end; ++i)
        {
            if (!partial_add_term(state, 1.0 / static_cast<double>(i)))
                return false;
        }
    }

    out_total = kahan_sum(state.cur, state.cur_count);
    return true;
}

inline HARMONIC_HD bool sum_chunk_adaptive(
    uint64_t start,
    uint64_t end,
    double &out_total)
{
    if (start >= TAIL_KAHAN_THRESHOLD)
        return sum_chunk_kahan(start, end, true, out_total);

    PartialState state;
    partial_clear(state);
    double sum = 0.0;
    double comp = 0.0;
    double inv = 1.0 / static_cast<double>(start);

    for (uint64_t i = start; i <= end; ++i)
    {
        if (i >= TAIL_KAHAN_THRESHOLD)
        {
            kahan_add(sum, comp, kahan_sum(state.cur, state.cur_count));
            for (; i <= end; ++i)
            {
                kahan_add(sum, comp, inv);
                if (i < end)
                    inv_step(i, inv);
            }
            out_total = sum;
            return true;
        }

        if (!partial_add_term(state, inv))
            return false;
        if (i < end)
            inv_step(i, inv);
    }

    out_total = kahan_sum(state.cur, state.cur_count);
    return true;
}

inline HARMONIC_HD bool sum_chunk_range(
    uint64_t start,
    uint64_t end,
    SumMode mode,
    double &out_total)
{
    switch (mode)
    {
    case SumMode::Accurate:
        return sum_chunk_compensated(start, end, false, out_total);
    case SumMode::Standard:
        return sum_chunk_compensated(start, end, true, out_total);
    case SumMode::Fast:
        return sum_chunk_kahan(start, end, true, out_total);
    case SumMode::Adaptive:
        return sum_chunk_adaptive(start, end, out_total);
    }
    return false;
}

inline const char *sum_mode_name(SumMode mode)
{
    switch (mode)
    {
    case SumMode::Accurate:
        return "accurate";
    case SumMode::Standard:
        return "standard";
    case SumMode::Fast:
        return "fast";
    case SumMode::Adaptive:
        return "adaptive";
    }
    return "unknown";
}

} // namespace harmonic
