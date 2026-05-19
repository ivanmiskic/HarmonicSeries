#pragma once

#include <cstdint>

#ifdef __CUDACC__
#define HARMONIC_HD __host__ __device__
#else
#define HARMONIC_HD
#endif

namespace harmonic {

// Harmonic chunks in double precision typically need far fewer slots than 256.
constexpr int MAX_PARTIALS = 64;

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

inline HARMONIC_HD bool sum_chunk_range(
    uint64_t start,
    uint64_t end,
    double &out_total)
{
    PartialState state;
    partial_clear(state);

    for (uint64_t i = start; i <= end; ++i)
    {
        const double term = 1.0 / static_cast<double>(i);
        if (!partial_add_term(state, term))
            return false;
    }

    out_total = kahan_sum(state.cur, state.cur_count);
    return true;
}

} // namespace harmonic
