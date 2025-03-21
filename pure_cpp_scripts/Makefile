# Makefile

CXX = g++
CXXFLAGS = -Wall -std=c++17
LIBS = -lcurl

all: main

# 최종 실행 파일
main: client_main.o client.o
	$(CXX) $(CXXFLAGS) -o main client_main.o client.o $(LIBS)

# main.cpp → main.o
client_main.o: client_main.cpp client.h
	$(CXX) $(CXXFLAGS) -c client_main.cpp

# client.cpp → client.o
client.o: client.cpp client.h
	$(CXX) $(CXXFLAGS) -c client.cpp

clean:
	rm -f *.o main
