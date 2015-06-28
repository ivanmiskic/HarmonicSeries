//Old version in case there is unexpected bugs in new one

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