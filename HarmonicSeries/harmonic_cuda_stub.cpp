#include "harmonic_runner.hpp"

#include <iostream>

namespace harmonic {

bool cuda_is_available()
{
    return false;
}

bool run_cuda(const Config &, RunStats &)
{
    std::cerr << "CUDA backend requested but this binary was built without CUDA (nvcc not found).\n"
              << "Install the CUDA toolkit and rebuild with: make CUDA=1\n";
    return false;
}

} // namespace harmonic
