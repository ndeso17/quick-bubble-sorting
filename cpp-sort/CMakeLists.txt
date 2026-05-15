cmake_minimum_required(VERSION 3.16)
project(sorter_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(sorter src/main.cpp)

if(UNIX)
  target_link_libraries(sorter PRIVATE pthread)
endif()
