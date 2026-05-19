# HarmonicSeries

Numerical experiment for computing large partial sums of the harmonic series:

\[
H_n = \sum_{k=1}^{n}\frac{1}{k}
\]

The project uses compensated summation ideas (partial-sum expansion + Kahan-style reduction) to maintain better floating-point stability than a naive `double` loop.

![Result sample](https://github.com/kebapmanager/HarmonicSeries/blob/master/See%20it%20in%20action/25.png)

## Why this project exists

The harmonic series diverges very slowly. Reaching a sum of `40` requires an astronomically large index:

- approximately `n ~= 1.32159290357566703e17` terms (from asymptotic analysis)
- this is far beyond practical brute-force iteration on consumer hardware

So this repository is both:

1. a numerical-accuracy experiment, and
2. a performance challenge around "how far can we push direct summation?"

## Current implementation (high level)

Main code lives in `HarmonicSeries/main.cpp`.

- Each worker thread sums one contiguous chunk of terms.
- Within a chunk, additions are done using a partial-sum list that preserves low-order residuals.
- At reporting boundaries, each chunk is reduced with Kahan summation.
- Chunk results are merged in `global_result`.

## Project structure

- `HarmonicSeries/main.cpp` - current active implementation
- `HarmonicSeries/backup.cpp` - old and experimental code paths
- `HarmonicSeries.sln` and `HarmonicSeries/*.vcxproj` - Visual Studio project files
- `See it in action/` - output screenshots and progress captures

## Build and run

### Visual Studio (original workflow)

Open `HarmonicSeries.sln` and build `Release|x64`.

### Linux (quick check)

From repository root:

```bash
g++ -O3 -std=c++17 -pthread HarmonicSeries/main.cpp -o harmonic_series
./harmonic_series
```

## Accuracy note

The project reports stable behavior even at very large iteration counts.

![Accuracy sample](https://github.com/kebapmanager/HarmonicSeries/blob/master/See%20it%20in%20action/Accuracy%20Sum%2029%20updated.png)

## Optimization and "sum 40" planning docs

See:

- `docs/project-review-and-sum40-plan.md`

That document contains:

- a quick code review
- practical optimization opportunities (short and medium term)
- a concrete plan to approach the `sum = 40` milestone more efficiently
