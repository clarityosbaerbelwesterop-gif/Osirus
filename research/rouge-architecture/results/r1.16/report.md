# Long context: R1.16

Bits per byte (mean ± SD over seeds); copy gain in bits per byte.

| metric | transformer | rouge-lm | window | lstm |
|---|---|---|---|---|
| stream.b0_0_256 | 1.914 ± 0.063 | 2.228 ± 0.038 | 2.036 ± 0.017 | 2.045 ± 0.020 |
| stream.b1_256_1k | 1.669 ± 0.065 | 1.729 ± 0.063 | 1.647 ± 0.015 | 1.846 ± 0.007 |
| stream.b2_1k_4k | 1.631 ± 0.043 | 1.671 ± 0.035 | 1.627 ± 0.015 | 1.733 ± 0.006 |
| stream.b3_4k_16k | 1.684 ± 0.043 | 1.708 ± 0.034 | 1.668 ± 0.005 | 1.787 ± 0.003 |
| stream.b4_16k_64k | 1.720 ± 0.033 | 1.744 ± 0.037 | 1.705 ± 0.011 | 1.822 ± 0.003 |
| copy.128.gain | 1.040 ± 0.316 | 0.051 ± 0.045 | -0.018 ± 0.071 | 0.261 ± 0.198 |
| copy.128.second_bpb | 8.467 ± 0.686 | 9.213 ± 0.322 | 9.196 ± 0.301 | 8.973 ± 0.123 |
| copy.1024.gain | -0.089 ± 0.091 | -0.051 ± 0.009 | -0.162 ± 0.051 | 0.019 ± 0.057 |
| copy.1024.second_bpb | 9.313 ± 0.400 | 9.362 ± 0.245 | 9.369 ± 0.182 | 9.060 ± 0.213 |
| copy.4096.gain | -0.099 ± 0.079 | -0.144 ± 0.089 | -0.184 ± 0.090 | -0.137 ± 0.048 |
| copy.4096.second_bpb | 9.282 ± 0.257 | 9.233 ± 0.313 | 9.126 ± 0.254 | 9.150 ± 0.099 |
| copy.16384.gain | -0.019 ± 0.036 | -0.067 ± 0.030 | -0.133 ± 0.135 | 0.121 ± 0.023 |
| copy.16384.second_bpb | 9.221 ± 0.308 | 9.128 ± 0.257 | 9.073 ± 0.185 | 9.034 ± 0.162 |
| throughput.4096 | 2238 B/s | 2884 B/s | 2830 B/s | 4030 B/s |
| memory.4096 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.4096 | 81920 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.16384 | 2139 B/s | 2894 B/s | 2845 B/s | 4015 B/s |
| memory.16384 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.16384 | 327680 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.65536 | 2151 B/s | 2869 B/s | 2886 B/s | 4074 B/s |
| memory.65536 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.65536 | 1310720 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.131072 | 2185 B/s | 2876 B/s | 2839 B/s | 4022 B/s |
| memory.131072 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.131072 | 2621440 KiB | 1224 KiB | 1280 KiB | 12 KiB |

`{"complete": true, "checks": {"C1_copy_beyond_window": false, "C1b_copy_vs_window_model": false, "C2_stable_far_out": false, "C3_far_vs_transformer": false, "C4_memory_128k": true, "C5_probe_broken": false}, "result": "FAIL"}`
