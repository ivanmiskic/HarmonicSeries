/*ksum: it basically works like this : keep a list of partial sums, take your remainder(initially your number you want to add)
for each partial sum : keep a backup of it, add the number, and subtract the backup from the sumult, what you get is what you actually added
you subtract that from the remainder to get your new remainder with which you go to the next partial sum
if something's left in the end you add it to the list of sums, and the swap changes your remainder with the current sum if it's bigger than it
so say you have one decimal digit precision and your sums 1, 0.1 and 0.01 and now want to add 1.111 to it : you add 1.111 to 1 and get 2,
the difference is 0.111 as remainder so you now have 2 + 0.1 + 0.01 + 0.111, then 2 + 0.2 + 0.01 + 0.011, then 2 + 0.2 + 0.02 + 0.001 and that's your new partial sum list.
that's adding one number - then you just keep going like that for every new number and in the end sum the sums via kahan summation*/

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

	size_t numOfThreads = std::thread::hardware_concurrency();
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
