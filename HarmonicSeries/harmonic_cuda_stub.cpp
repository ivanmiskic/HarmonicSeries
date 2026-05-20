#include "harmonic_runner.hpp"

#include <iostream>

namespace harmonic {

bool cuda_is_available()
{
    return false;
}

bool cuda_init_device(const Config &, std::string &)
{
    return false;
}

bool cuda_session_init(CudaSession &, const Config &, std::string &)
{
    return false;
}

void cuda_session_fini(CudaSession &) {}

bool cuda_session_run_range(CudaSession &, const Config &, RunStats &, uint64_t, uint64_t, bool)
{
    return false;
}

bool run_cuda_index_range(const Config &, RunStats &, uint64_t, uint64_t, bool)
{
    return false;
}

bool run_cuda(const Config &, RunStats &)
{
    std::cerr << "CUDA backend requested but this binary was built without CUDA (nvcc not found).\n"
              << "Install the CUDA toolkit and rebuild with: make CUDA=1\n";
    return false;
}

bool list_cuda_gpus_json()
{
    std::cout << "[]" << std::endl;
    return true;
}

} // namespace harmonic
