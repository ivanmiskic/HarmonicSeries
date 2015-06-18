# HarmonicSeries
Calculating the sum of n partial sums of divergent harmonic series

![alt tag](https://github.com/kebapmanager/HarmonicSeries/blob/master/See%20it%20in%20action/27.png)


##Accuracy
Either wolfram alpha is using aproximate caluclations or more likely my algorithm is rounding numbers up more than it should due to floating point precision problems(Even though I am using [Kahan summation algorithm][https://en.wikipedia.org/wiki/Kahan_summation_algorithm])

Same goal of sum reaching 29 was acomplished in approximately in 1.45 billion calculations less in the total of 2.2 trillion iterations

![alt tag](https://github.com/kebapmanager/HarmonicSeries/blob/master/See%20it%20in%20action/Accuracy%202.png)
