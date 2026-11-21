### base (test, 504 requests; confidence = min of the two turns' engine confidence)

The base checkpoint exported at 4 bits per depth (`export_cact.py`), and the published 2-bit
`needle3.cact` ("published"), both untrained, two turns through the native engine on envy.

| depth | exact | exact on-topic | refused off-topic | router right | AUROC | ECE | ms mean | ms p95 |
|---|---|---|---|---|---|---|---|---|
| L20 | 0.355 | 0.273 | 0.922 | 0.539 | 0.635 | 0.136 | 529 | 739 |
| L19 | 0.341 | 0.268 | 0.844 | 0.475 | 0.683 | 0.084 | 550 | 814 |
| L18 | 0.353 | 0.284 | 0.828 | 0.520 | 0.677 | 0.083 | 520 | 767 |
| L17 | 0.228 | 0.148 | 0.781 | 0.325 | 0.719 | 0.255 | 512 | 766 |
| L16 | 0.280 | 0.193 | 0.875 | 0.400 | 0.644 | 0.142 | 532 | 819 |
| L15 | 0.220 | 0.127 | 0.859 | 0.280 | 0.788 | 0.203 | 457 | 638 |
| L14 | 0.242 | 0.145 | 0.906 | 0.350 | 0.778 | 0.178 | 517 | 994 |
| L13 | 0.268 | 0.182 | 0.859 | 0.409 | 0.716 | 0.129 | 390 | 531 |
| L12 | 0.226 | 0.125 | 0.922 | 0.425 | 0.590 | 0.245 | 669 | 1496 |
| L11 | 0.185 | 0.084 | 0.875 | 0.339 | 0.724 | 0.217 | 371 | 622 |
| L10 | 0.206 | 0.118 | 0.812 | 0.375 | 0.613 | 0.196 | 589 | 1368 |
| L09 | 0.192 | 0.086 | 0.922 | 0.343 | 0.648 | 0.145 | 543 | 1066 |
| L08 | 0.185 | 0.068 | 0.984 | 0.273 | 0.620 | 0.231 | 285 | 538 |
| L07 | 0.163 | 0.059 | 0.875 | 0.305 | 0.465 | 0.342 | 442 | 889 |
| L06 | 0.149 | 0.045 | 0.859 | 0.282 | 0.560 | 0.227 | 344 | 790 |
| L05 | 0.161 | 0.045 | 0.953 | 0.211 | 0.284 | 0.246 | 187 | 350 |
| L04 | 0.151 | 0.041 | 0.906 | 0.214 | 0.609 | 0.046 | 164 | 287 |
| L03 | 0.127 | 0.000 | 1.000 | 0.145 | nan | nan | 204 | 427 |
| L02 | 0.127 | 0.000 | 1.000 | 0.000 | nan | nan | 41 | 78 |
| published | 0.317 | 0.259 | 0.719 | 0.455 | 0.597 | 0.109 | 2834 | 3594 |

Times were taken with four scoring processes sharing the CPU, so they compare depths, not a
single person's wait (see bench_native.py for that).

### Forgetting check, base (300 requests: 100 each from google/mobile-actions, hermes-function-calling-v1, When2Call)

| archive | mobile-actions | hermes | When2Call (no call) | all |
|---|---|---|---|---|
| published needle3.cact (2-bit) | 0.83 | 0.15 | 0.39 | 0.457 |
| base checkpoint at 4 bits, L20 | 0.77 | 0.19 | 0.17 | 0.377 |
