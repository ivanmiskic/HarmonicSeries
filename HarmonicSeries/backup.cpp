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
	double res;

	std::vector<double> result;
	std::vector<double> newResult;

	// accumulate iterable into partial sums
	//Infinite loop because calculating sum each iteration would cost us performance
	for (uint64_t i = 1; res < 40; ++i)
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

		//print every 10 million iterations
		if (0U == (i % 10000000U))
		{
			res = ksum(result);
			time_passed = difftime(time(0), start);
			std::cout << std::fixed << std::setprecision(15) << "Iteration " << i << ": " << res
				<< "   " << std::setprecision(1) << "sec: " << time_passed
				<< "  min: " << time_passed / 60
				<< "  h: " << time_passed / 3600 << std::endl;
		}
		newResult.clear();
	}
}

int main()
{
	//std::cout << "Compile time: " << __TIME__ << std::endl;
	sum();

	//for msum: it basically works like this : keep a list of partial sums, take your remainder(initially your number you want to add)
	//for each partial sum : keep a backup of it, add the number, and subtract the backup from the result
	//what you get is what you actually added
	//you subtract that from the remainder to get your new remainder with which you go to the next partial sum
	//if something's left in the end you add it to the list of sums
	//and the swap changes your remainder with the current sum if it's bigger than it
	//so say you have one decimal digit precision and your sums 1, 0.1 and 0.01 and now want to add 1.111 to it : you add 1.111 to 1 and get 2,
	//the difference is 0.111 as remainder so you now have 2 + 0.1 + 0.01 + 0.111, then 2 + 0.2 + 0.01 + 0.011, then 2 + 0.2 + 0.02 + 0.001 and that's your new partial sum list.
	//that's adding one number - then you just keep going like that for every new number and in the end sum the sums via kahan summation
}
*/