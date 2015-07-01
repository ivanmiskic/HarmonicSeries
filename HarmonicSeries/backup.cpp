//Old version in case there is unexpected bugs in new one








__global__ void sum(double *result, double *newResult)
{
	uint64_t iterations = 100U;      //100 mil
	uint64_t start = 1;                                      // Iteration previouse runs
	uint64_t end = 1 * iterations;   //iter * iterations;

	size_t newResIndex = 0;
	size_t resIndex = 0;

	for (uint64_t i = start; i < end; ++i)
	{
		double x = 1.0 / (double)i;

		if (i == 2)
			resIndex = 1;
		else if (i >= 3)
			resIndex = 2;

		for (int j = 0; j < resIndex; j++)
		{
			double y = result[j];
			double high = x + y, low;
			if (x < y)
				low = x - (high - y);
			else low = y - (high - x);

			if (low){
				newResult[newResIndex] = low;
				newResIndex++;
			}

			x = high;
		}
		newResult[newResIndex] = x;
		newResIndex++;
		//Swap result with newResult
		double *temp = newResult;
		result = temp;

		newResIndex = 0;
	}
}




/*


#define _CRT_SECURE_NO_WARNINGS
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <vector>
#include <ctime>
#include <time.h>
#include <iomanip>

//Kahan summation algorithm
double ksum(const std::vector<double> &data)
{
double compensation = 0;
double sum = 0;
std::vector<double>::size_type index = data.size();
while (index--)
{
double x = data[index] - compensation;
double y = sum + x;
compensation = (y - sum) - x;
sum = y;
}
return sum;
}

void sum()
{
time_t start = time(0);
double time_passed;

double sum = 0;
double last_sum = 0;			 // Sum from previouse runs
double goal = 40;				 // Original goal was 40
unsigned int start_time = 0;	 // Time from previouse runs
uint64_t starting_iteration = 1; // Iteration previouse runs

std::vector<double> result;
std::vector<double> newResult;

if (last_sum > 0)
result.push_back(last_sum);


// accumulate iterable into partial sums
for (uint64_t i = starting_iteration; sum < goal; ++i)
{
double x = 1.0 / (double)i;

for (auto &y : result)
{
if (x < y)
std::swap(x, y);

double high = x + y;
double low = y - (high - x);

if (low)
newResult.push_back(low);

x = high;
}
newResult.push_back(x);
swap(result, newResult);

//print every 10 million iterations, adding new counter that counts to 10 mil and checking if its bigger than const 10mil would maybe be faster?
if (0U == (i % 10000000U))
{
sum = ksum(result); //begin(result), end(result)
time_passed = difftime(time(0), start) + start_time;
std::cout << std::fixed << std::setprecision(15) << "Iteration " << i << ": " << sum
<< "   " << std::setprecision(1) << "sec: " << time_passed
<< "  min: " << time_passed / 60
<< "  h: " << time_passed / 3600 << std::endl;
		}
		newResult.clear();
	}
}

int main()
{
	sum();
}
*/









/*
#define _CRT_SECURE_NO_WARNINGS
#include <cstdint>
#include <iostream>
#include <limits>
#include <vector>
#include <ctime>
#include <time.h>
#include <iomanip>
#include <thread>

std::vector<double> global_result;
size_t global_counter = 0;

time_t start;
double time_passed;
unsigned int start_time = 0;		 // Time from previouse runs

//Kahan summation algorithm
double ksum(const std::vector<double> &data)
{
double compensation = 0;
double sum = 0;
//std::vector<double>::size_type index = data.size();
size_t index = data.size();
while (index--)
{
double x = data[index] - compensation;
double y = sum + x;
compensation = (y - sum) - x;
sum = y;
}
return sum;
}

void sum(uint64_t iter)
{
double sum = 0;
double last_sum = 0;				 // Sum from previouse runs
double goal = 40;					 // Original goal was 40

uint64_t iterations = 100000000U;
uint64_t starting_iteration = (iter * iterations) - iterations + 1; // Iteration previouse runs
uint64_t end = iter * iterations;

std::vector<double> result;
std::vector<double> newResult;

if (last_sum > 0)
result.push_back(last_sum);

// accumulate iterable into partial sums
for (uint64_t i = starting_iteration; i < end; ++i)
{
double x = 1.0 / (double)i;
for (auto &y : result)
{
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

if (low)
newResult.push_back(low);

x = high;
}
newResult.push_back(x);
swap(result, newResult);

newResult.clear();
}
std::cout << "iter " << iter - 1 << ": " << ksum(result) << std::endl;
global_result[iter - 1] += ksum(result);
}

void printGlobalResult() // thread this and put it to sleep for a minute
{
while (1)
{
double sum = ksum(global_result);

for (int i = 0; i < 4; ++i)
std::cout << "Result of iteration(" << i << "): " << global_result[i] << std::endl;

time_passed = difftime(time(0), start) + start_time;
std::cout << std::fixed << std::setprecision(15) << "Iteration " << ": " << sum
<< "   " << std::setprecision(1) << "sec: " << time_passed
<< "  min: " << time_passed / 60
<< "  h: " << time_passed / 3600 << std::endl;
std::this_thread::sleep_for(std::chrono::seconds(2));
	}
}

int main()
{
	start = time(0);

	size_t numOfThreads = 1;// std::thread::hardware_concurrency();
	std::vector<std::thread> threads;
	global_result.resize(numOfThreads);

	std::cout << "Create " << numOfThreads << " threads..." << std::endl;
	for (size_t i = 0; i < numOfThreads; ++i)
		threads.push_back(std::thread(sum, i + 1));


	std::cout << "Synchronizing all threads...\n";
	for (auto& th : threads)
		th.join();

	printGlobalResult();
	//	std::thread(printGlobalResult);
}
*/