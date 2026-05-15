#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <condition_variable>
#include <cstring>
#include <exception>
#include <functional>
#include <iostream>
#include <mutex>
#include <optional>
#include <queue>
#include <random>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef __linux__
#include <pthread.h>
#include <sched.h>
#include <sys/resource.h>
#include <unistd.h>
#endif

struct Config {
  std::string algorithm = "quick";
  std::size_t n = 100000;
  std::size_t threads = 4;
  std::size_t ramMb = 512;
  bool pinCores = false;
  bool verify = true;
};

struct Stats {
  std::uint64_t comparisons = 0;
  std::uint64_t swaps = 0;
};

class ThreadPool {
 public:
  explicit ThreadPool(std::size_t workers, bool pin_cores)
      : stop_(false), pin_cores_(pin_cores) {
    if (workers == 0) workers = 1;
    workers_.reserve(workers);
    for (std::size_t i = 0; i < workers; ++i) {
      workers_.emplace_back([this, i] {
#ifdef __linux__
        if (pin_cores_) {
          pinThreadToCore(i);
        }
#endif
        runLoop();
      });
    }
  }

  ~ThreadPool() {
    {
      std::lock_guard<std::mutex> lk(mutex_);
      stop_ = true;
    }
    cv_.notify_all();
    for (auto &w : workers_) {
      if (w.joinable()) w.join();
    }
  }

  template <typename Fn>
  void enqueue(Fn &&fn) {
    {
      std::lock_guard<std::mutex> lk(mutex_);
      tasks_.emplace(std::forward<Fn>(fn));
    }
    cv_.notify_one();
  }

  void waitIdle() {
    std::unique_lock<std::mutex> lk(done_mutex_);
    done_cv_.wait(lk, [this] {
      std::lock_guard<std::mutex> qlk(mutex_);
      return tasks_.empty() && active_ == 0;
    });
  }

  std::size_t size() const { return workers_.size(); }

 private:
#ifdef __linux__
  void pinThreadToCore(std::size_t idx) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    long cores = sysconf(_SC_NPROCESSORS_ONLN);
    if (cores <= 0) return;
    CPU_SET(static_cast<int>(idx % static_cast<std::size_t>(cores)), &cpuset);
    pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset);
  }
#endif

  void runLoop() {
    while (true) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lk(mutex_);
        cv_.wait(lk, [this] { return stop_ || !tasks_.empty(); });
        if (stop_ && tasks_.empty()) return;
        task = std::move(tasks_.front());
        tasks_.pop();
        ++active_;
      }

      task();

      {
        std::lock_guard<std::mutex> lk(mutex_);
        --active_;
      }
      done_cv_.notify_all();
    }
  }

  std::vector<std::thread> workers_;
  std::queue<std::function<void()>> tasks_;
  mutable std::mutex mutex_;
  std::condition_variable cv_;
  std::atomic<std::size_t> active_{0};
  bool stop_;
  bool pin_cores_;

  std::mutex done_mutex_;
  std::condition_variable done_cv_;
};

#ifdef __linux__
void setProcessMemoryLimitMb(std::size_t mb) {
  rlimit lim{};
  lim.rlim_cur = static_cast<rlim_t>(mb) * 1024ULL * 1024ULL;
  lim.rlim_max = lim.rlim_cur;
  if (setrlimit(RLIMIT_AS, &lim) != 0) {
    throw std::runtime_error("Failed to set RLIMIT_AS");
  }
}
#endif

Config parseArgs(int argc, char **argv) {
  Config c;
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    auto next = [&](const char *name) -> std::string {
      if (i + 1 >= argc) throw std::runtime_error(std::string("Missing value for ") + name);
      return argv[++i];
    };

    if (a == "--algo") c.algorithm = next("--algo");
    else if (a == "--n") c.n = std::stoull(next("--n"));
    else if (a == "--threads") c.threads = std::stoull(next("--threads"));
    else if (a == "--ram-mb") c.ramMb = std::stoull(next("--ram-mb"));
    else if (a == "--pin-cores") c.pinCores = true;
    else if (a == "--no-verify") c.verify = false;
    else if (a == "--help") {
      std::cout
          << "Usage: sorter --algo quick|bubble --n <size> --threads <num> --ram-mb <mb> [--pin-cores] [--no-verify]\n";
      std::exit(0);
    } else {
      throw std::runtime_error("Unknown argument: " + a);
    }
  }

  if (c.algorithm != "quick" && c.algorithm != "bubble") {
    throw std::runtime_error("--algo must be quick or bubble");
  }
  if (c.n < 2) c.n = 2;
  if (c.threads < 1) c.threads = 1;
  if (c.ramMb < 64) c.ramMb = 64;

  return c;
}

std::vector<int> makeShuffled(std::size_t n) {
  std::vector<int> v(n);
  for (std::size_t i = 0; i < n; ++i) v[i] = static_cast<int>(i + 1);
  std::mt19937 rng(std::random_device{}());
  std::shuffle(v.begin(), v.end(), rng);
  return v;
}

void bubbleOddEvenParallel(std::vector<int> &arr, ThreadPool &pool, Stats &stats) {
  (void)pool;
  const std::size_t n = arr.size();
  for (std::size_t i = 0; i < n - 1; ++i) {
    bool swapped = false;
    for (std::size_t j = 0; j < n - 1 - i; ++j) {
      ++stats.comparisons;
      if (arr[j] > arr[j + 1]) {
        std::swap(arr[j], arr[j + 1]);
        ++stats.swaps;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
}

void quickParallel(std::vector<int> &arr, ThreadPool &pool, Stats &stats) {
  struct Range { int l; int r; };
  std::mutex qMutex;
  std::queue<Range> q;
  q.push({0, static_cast<int>(arr.size() - 1)});

  std::atomic<int> inFlight{0};
  std::atomic<bool> done{false};
  std::mutex arrMutex;

  auto workerFn = [&]() {
    while (!done.load(std::memory_order_acquire)) {
      Range range;
      bool has = false;
      {
        std::lock_guard<std::mutex> lk(qMutex);
        if (!q.empty()) {
          range = q.front();
          q.pop();
          has = true;
          inFlight.fetch_add(1, std::memory_order_relaxed);
        }
      }

      if (!has) {
        if (inFlight.load(std::memory_order_relaxed) == 0) {
          std::lock_guard<std::mutex> lk(qMutex);
          if (q.empty()) {
            done.store(true, std::memory_order_release);
            return;
          }
        }
        std::this_thread::yield();
        continue;
      }

      int l = range.l;
      int r = range.r;
      if (l < r) {
        int p;
        {
          std::lock_guard<std::mutex> lk(arrMutex);
          int pivot = arr[r];
          int i = l - 1;
          for (int j = l; j < r; ++j) {
            ++stats.comparisons;
            if (arr[j] <= pivot) {
              ++i;
              if (i != j) {
                std::swap(arr[i], arr[j]);
                ++stats.swaps;
              }
            }
          }
          if (i + 1 != r) {
            std::swap(arr[i + 1], arr[r]);
            ++stats.swaps;
          }
          p = i + 1;
        }

        {
          std::lock_guard<std::mutex> lk(qMutex);
          if (l < p - 1) q.push({l, p - 1});
          if (p + 1 < r) q.push({p + 1, r});
        }
      }

      inFlight.fetch_sub(1, std::memory_order_relaxed);
    }
  };

  for (std::size_t i = 0; i < pool.size(); ++i) {
    pool.enqueue(workerFn);
  }
  pool.waitIdle();
}

bool isSorted(const std::vector<int> &v) {
  for (std::size_t i = 1; i < v.size(); ++i) {
    if (v[i - 1] > v[i]) return false;
  }
  return true;
}

int main(int argc, char **argv) {
  try {
    Config cfg = parseArgs(argc, argv);

#ifdef __linux__
    setProcessMemoryLimitMb(cfg.ramMb);
#endif

    auto data = makeShuffled(cfg.n);
    Stats stats;

    ThreadPool pool(cfg.threads, cfg.pinCores);

    auto t0 = std::chrono::steady_clock::now();
    if (cfg.algorithm == "bubble") {
      bubbleOddEvenParallel(data, pool, stats);
    } else {
      quickParallel(data, pool, stats);
    }
    auto t1 = std::chrono::steady_clock::now();

    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    bool ok = true;
    if (cfg.verify) ok = isSorted(data);

    std::cout << "algorithm=" << cfg.algorithm
              << " n=" << cfg.n
              << " threads=" << cfg.threads
              << " ram_mb=" << cfg.ramMb
              << " duration_ms=" << ms
              << " comparisons=" << stats.comparisons
              << " swaps=" << stats.swaps
              << " sorted=" << (ok ? "true" : "false")
              << "\n";

    return ok ? 0 : 2;
  } catch (const std::exception &e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
