CXX ?= g++
NVCC ?= nvcc

CXXFLAGS = -O3 -std=c++17 -Wall -Wextra -pthread -Iinclude
NVCCFLAGS = -O3 -std=c++17 -Iinclude --extra-device-vectorization
CUDA_HOME ?= /opt/cuda
CUDA_LDFLAGS = -L$(CUDA_HOME)/lib64 -Wl,-rpath,$(CUDA_HOME)/lib64

TARGET = harmonic_series
CPU_SRC = HarmonicSeries/main.cpp \
          HarmonicSeries/harmonic_cpu.cpp \
          HarmonicSeries/harmonic_estimator.cpp \
          HarmonicSeries/harmonic_distributed.cpp

.PHONY: all clean run run-cuda estimate help

all: cpu

cpu: $(TARGET)

# Set CUDA=1 or install nvcc; auto-enables when nvcc is on PATH.
CUDA ?= $(shell command -v $(NVCC) >/dev/null 2>&1 && echo 1 || echo 0)

# Optional: make FAST_MATH=1 or pass --fast-math at runtime (rebuild with FAST_MATH=1)
ifeq ($(FAST_MATH),1)
  NVCCFLAGS += --use_fast_math -DHARMONIC_FAST_MATH
endif

ifeq ($(CUDA),1)
$(TARGET): $(CPU_SRC) HarmonicSeries/harmonic_cuda.cu
	@mkdir -p build
	$(NVCC) $(NVCCFLAGS) -c HarmonicSeries/harmonic_cuda.cu -o build/harmonic_cuda.o
	$(CXX) $(CXXFLAGS) $(CPU_SRC) build/harmonic_cuda.o -o $(TARGET) $(CUDA_LDFLAGS) -lcudart
	@echo "Built with CUDA support ($(NVCC))"
else
$(TARGET): $(CPU_SRC) HarmonicSeries/harmonic_cuda_stub.cpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) $(CPU_SRC) HarmonicSeries/harmonic_cuda_stub.cpp -o $(TARGET)
	@echo "Built CPU-only (install cuda / nvcc and run: make CUDA=1)"
endif

cuda: CUDA=1
cuda: clean $(TARGET)

run: $(TARGET)
	./$(TARGET) --backend cpu --chunk-size 1000000 --threads 4 --quiet

run-cuda: $(TARGET)
	./$(TARGET) --backend cuda --quiet

estimate: $(TARGET)
	./$(TARGET) --backend estimate --target 40

clean:
	rm -rf build $(TARGET)

help:
	@echo "Targets: all, cuda, run, run-cuda, estimate, clean"
	@echo "CUDA=1     build with nvcc"
	@echo "FAST_MATH=1  add --use_fast_math to nvcc"
