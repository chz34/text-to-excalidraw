# [RFC] torch_npu 多版本 PyTorch 兼容层

## 背景描述（Background）

torch_npu 作为华为昇腾 NPU 的 PyTorch 扩展，需要跟随上游 PyTorch 的版本迭代持续演进。上游 PyTorch 在每个 minor 版本中都可能引入 API 路径变更、用法变化、接口重命名或内部 bugfix，导致 torch_npu 无法用同一份代码同时兼容多个 PyTorch 版本。

当前痛点：

- **版本差异处理散乱**：兼容代码分散在各业务文件中，缺乏统一规范，难以追踪哪些差异仍需维护、哪些已可安全删除。
- **维护成本高**：没有明确的退出机制，旧版本的兼容代码长期积累，形成技术债。
- **构建与版本不对齐**：构建时 wheel 版本号与目标 PyTorch 版本号分离，给用户安装和问题排查带来困扰。

以下为当前支持窗口（v2.10 / v2.11 / v2.12 dev）内已识别的具体版本差异，直观说明了问题的规模与复杂度：

**Python 层**

| 差异点 | v2.10 | v2.11 | 类型 |
|--------|-------|-------|------|
| `register_op_strategy` / `register_prop_rule` | `_ops.registration` | `_ops.utils` | 上游路径变化 |
| `sizevars.var_to_val` | 原名 | `sizevars.backed_var_to_val` | 上游改名 |
| `CachingAutotuner` | `runtime.triton_heuristics` | `triton_heuristics` | 上游路径变化 |
| `gen_common_triton_imports()` | 模块级函数 | 实例方法 | 上游用法变化 |
| `patch_extern_kernel_codegen_size_asserts` | 需要 patch | 上游已修复 | 内部 bugfix |
| `allow_same_symbol_in_index` | 需要 workaround | 上游已修复 | 内部 bugfix |

**C++ 层**

| 差异点 | 类型 |
|--------|------|
| `aoti_runtime/model.h` `load_constants` 混合设备支持 | 上游新增接口 |
| `ProcessGroupHCCL` 析构函数去除 try/catch | 内部 bugfix |

目标是：
通过**结构化的多版本兼容层**，统一管理 Python 层和 C++ 层的版本差异，明确兼容代码的写入规范、集中目录、生命周期管理和退出流程，：

- 在保持单一代码库的前提下，同时支持最近多个稳定版 + 1 个当前开发版。（目前分析的是2个稳定版本，1个dev版本）
- 让兼容代码可被扫描、可被追踪、有明确退出条件，将维护成本最小化。设计上尽量，避免冗余的复杂机制，充分发挥当下AI进行基础代码维护的能力。
- 统一构建入口，确保 wheel 版本号与目标 PyTorch 版本对齐。

---

## 用例分析（Use Case）

### UC-1：新增上游 API 路径变化

上游将某模块从路径 A 移动到路径 B（如 `register_op_strategy` 从 `_ops.registration` 移到 `_ops.utils`）。torch_npu 需要在新旧版本均可正常 import，且不污染业务代码。

**功能点**：按版本条件选择 import 路径；多文件共用同一符号时集中到 `_compat/` 避免重复。

### UC-2：新增上游调用方式变化

上游将模块级函数改为实例方法（如 `gen_common_triton_imports()`），调用签名发生变化。torch_npu 需要对外暴露统一接口，内部屏蔽版本差异。

**功能点**：`_compat/` 中提供适配包装函数，调用方无需感知版本分支。

### UC-3：可选依赖模块的懒加载

某些模块（如 triton）在构建中不直接依赖，运行时模块级 import 会直接失败。torch_npu 需要支持在没有 triton 的环境下正常加载。

**功能点**：将 import 封装为函数，通过lazy_import实现仅在实际调用时才执行，避免模块加载时崩溃。

### UC-4：旧版本退出（版本窗口滚动）

当 v2.10 退出支持窗口后，所有针对 `< 2.11` 的 else 分支均可删除。需要一个可自动化的清理流程，保障删除操作不遗漏、不误删。

**功能点**：扫描脚本 `tools/check_compat.py` 识别所有过期 `COMPAT` 标记，CI 中运行以防止旧兼容代码被遗忘。

### UC-5：多版本构建（CI/CD）

CI 流水线需要针对不同 PyTorch 版本分别构建 wheel，并保证 wheel 文件名、`torch_npu.__version__` 以及 C++ 编译宏三者与目标版本一致。

**功能点**：`ci/build.sh --torch=X.Y.Z` 同时完成版本校验与 `version.txt` 写入，setup.py 统一从 `version.txt` 读取版本号。

### DFX 要求

| 属性   | 要求                                                    |
| ---- | ----------------------------------------------------- |
| 可维护性 | 每处兼容代码必须注明退出条件（`COMPAT(>= X.Y)` / `CAN REMOVE`）和一句话原因 |
| 可测试性 | 扫描脚本纳入 CI，防止过期兼容代码漏删；构建脚本版本校验防止错配                     |
| 兼容性  | 支持窗口内 3 个版本的 Python 层与 C++ 层均通过同一代码库构建                |
| 可靠性  | lazy import模式（UC-3）保证不因可选模块缺失而崩溃                      |

---

## 方案设计（Design Details）

### 1. 总体思路

引入两个兼容层目录，将版本差异处理从业务代码中剥离或标准化：

```
torch_npu/_compat/          ← Python 兼容层
torch_npu/csrc/_compat/     ← C++ 兼容层（预留，按需创建）
```

![兼容层总体架构](assets/rfc-arch.svg)

版本判断的唯一来源：

- **Python**：`_compat/version.py` 中的 `CURRENT_VERSION`（运行时从 `torch.__version__` 解析）和 `MIN_SUPPORTED_VERSION`（退出旧版本时在此修改）。
- **C++**：`setup.py` 传入 `-DTORCH_VERSION`，CMake 转换为整数宏 `TORCH_NPU_TORCH_VERSION`（`major * 100 + minor`，如 2.11 → 211）。

### 2. 三种 Python 兼容模式

#### 模式 A：import 路径 / 名称变化

在调用文件原位使用 `if/else`，加 `COMPAT` 注释。若多个文件共用同一符号，则集中到 `_compat/<子系统>.py`，调用方统一从那里 import：

```python
# COMPAT(>= 2.11): register_op_strategy moved from _ops.registration to _ops.utils
# CAN REMOVE when MIN_SUPPORTED >= (2, 11): use _ops.utils directly
if CURRENT_VERSION >= (2, 11):
    from torch.distributed.tensor._ops.utils import register_op_strategy
else:
    from torch.distributed.tensor._ops.registration import register_op_strategy
```

**适用**：符号始终存在，仅路径或名称不同。

#### 模式 B：调用方式变化

封装为适配函数，版本分支在函数内部，外部使用统一接口：

```python
# _compat/inductor.py
# COMPAT(>= 2.11): gen_common_triton_imports became instance method
# CAN REMOVE when MIN_SUPPORTED >= (2, 11): inline kernel.gen_common_triton_imports()
def gen_common_triton_imports(kernel):
    if CURRENT_VERSION >= (2, 11):
        return kernel.gen_common_triton_imports()
    from torch._inductor.codegen.triton import gen_common_triton_imports as _fn
    return _fn()
```

**适用**：目标模块始终存在，但调用签名不同。

#### 模式 C：可选模块懒加载

将 import 封装为函数，仅在实际调用时执行：

```python
# _compat/inductor.py
# COMPAT(>= 2.11): CachingAutotuner moved from runtime.triton_heuristics to triton_heuristics
# CAN REMOVE when MIN_SUPPORTED >= (2, 11): import from triton_heuristics directly
def get_CachingAutotuner():
    if CURRENT_VERSION >= (2, 11):
        from torch._inductor.triton_heuristics import CachingAutotuner
    else:
        from torch._inductor.runtime.triton_heuristics import CachingAutotuner
    return CachingAutotuner
```

**适用**：目标模块在某些构建（如 CPU-only）中根本不存在，不可在模块级 import。

### 3. C++ 兼容模式

**实现差异**：原位 `#if` 宏 + `CAN REMOVE` 注释：

```cpp
// COMPAT(>= 211): new API added in 2.11
// CAN REMOVE < 211 branch when MIN_SUPPORTED >= 211
#if TORCH_NPU_VERSION_GE(211)
    // new behavior
#else
    // old behavior
#endif
```

**引用差异**：在 `csrc/_compat/` 下建独立头文件，暴露兼容类型或函数名。

**版本宏定义**（`csrc/_compat/version_compat.h`）：

```cpp
#pragma once
#ifndef TORCH_NPU_TORCH_VERSION
#error "TORCH_NPU_TORCH_VERSION must be defined by CMake"
#endif
#define TORCH_NPU_VERSION_GE(ver)  (TORCH_NPU_TORCH_VERSION >= (ver))
#define TORCH_NPU_VERSION_LT(ver)  (TORCH_NPU_TORCH_VERSION <  (ver))
```

### 4. 构建脚本（`ci/build.sh`）

#### 参数说明

| 参数              | 说明                                                     |
| --------------- | ------------------------------------------------------ |
| `--python=X.Y`  | 指定 Python 版本，默认 3.9，支持 3.9 / 3.10 / 3.11 / 3.12 / 3.13 |
| `--torch=X.Y.Z` | 指定目标 PyTorch 版本，支持 2.10.0 / 2.11.0 / 2.12.0            |

#### `--torch` 的两个作用

指定 `--torch=X.Y.Z` 时，脚本会：

1. **校验**已安装的 PyTorch major.minor 是否与 X.Y.Z 一致，不匹配则报错退出
2. **写入** `version.txt` 为 `X.Y.Z`，使 setup.py 打出的 wheel 版本与目标 PyTorch 版本对齐

不指定 `--torch` 时，两步均跳过：使用环境中已安装的 PyTorch，`version.txt` 保持不变。

#### 典型用法

```bash
# 针对 PyTorch 2.11 构建，wheel 版本自动写为 2.11.0
bash ci/build.sh --python=3.10 --torch=2.11.0

# 针对 PyTorch 2.10 构建
bash ci/build.sh --python=3.10 --torch=2.10.0

# 不指定 torch 版本，使用环境现有版本构建
bash ci/build.sh --python=3.10
```

#### 版本流向

```
--torch=2.11
    │
    ├─ 校验：python3.10 -c "import torch; print(torch.__version__)"
    │         → 不是 2.11.x 则报错退出
    │
    └─ 写入：echo "2.11.0" > version.txt
              │
              └─ setup.py 读取 version.txt → VERSION = "2.11.0"
                    ├─ wheel 文件名：torch_npu-2.11.0-cp310-...whl
                    ├─ torch_npu.__version__ = "2.11.0+gitXXX"
                    └─ CMake -DTORCH_VERSION=2.11.0 → PYTORCH_NPU_VERSION 宏
```


#### 构建版本注入流程

![构建版本注入流程](assets/rfc-build.svg)

```
ci/build.sh --torch=2.11.0
    │
    ├─ 校验：检查已安装 PyTorch 是否为 2.11.x，否则报错退出
    │
    └─ 写入：echo "2.11.0" > version.txt
              │
              └─ setup.py 读取 version.txt → VERSION = "2.11.0"
                    ├─ wheel 文件名：torch_npu-2.11.0-cp310-...whl
                    ├─ torch_npu.__version__ = "2.11.0+gitXXX"
                    └─ CMake -DTORCH_VERSION=2.11.0 → TORCH_NPU_TORCH_VERSION=211
```

### 5. 支持窗口与退出流程

维护 3 个版本：最近 2 个稳定版 + 1 个 dev 版，版本窗口随新稳定版发布向前滚动：

![版本支持窗口滚动](assets/rfc-window.svg)

```
现在：       v2.10  v2.11  v2.12(dev)
v2.12 发布： v2.11  v2.12  v2.13(dev)
v2.13 发布：        v2.12  v2.13  v2.14(dev)
```

退出旧版本步骤：

1. 修改 `_compat/version.py` 中 `MIN_SUPPORTED_VERSION`
2. 运行 `python tools/check_compat.py` 找出所有过期 `COMPAT` 标记
3. 按报告逐条删除旧分支，调用方改为直接使用新路径
4. CI 全量验证通过后合并

---

## 使用说明（User Guide）

### 新增一处版本差异

1. 判断差异类型，选择对应模式：

| 差异类型        | 选用模式                                |
| ----------- | ----------------------------------- |
| 上游路径 / 名称变化 | 模式 A（if/else，原位或集中到 `_compat/`）     |
| 上游调用方式变化    | 模式 B（`_compat/` 适配函数）               |
| 可选模块依赖（懒加载） | 模式 C（`_compat/` lazy_import函数）      |
| C++ 实现差异    | 原位 `#if` 宏                          |
| C++ 引用差异    | `csrc/_compat/<subsystem>_compat.h` |

2. 每处差异**必须**写明：
   - `COMPAT(>= X.Y)` 或 `CAN REMOVE when MIN_SUPPORTED >= (X, Y)` —— 退出条件
   - 一句话说明上游变化原因

3. 多个文件共用同一符号时，集中到 `_compat/<子系统>.py`，避免重复写 if/else。

### 构建参数说明

`ci/build.sh` 新增 `--torch` 参数：

| 参数 | 说明 |
|------|------|
| `--torch=X.Y.Z` | 指定目标 PyTorch 版本（如 `2.11.0`），同时校验已安装版本并写入 `version.txt` |

不指定 `--torch` 时，两步均跳过，使用环境中已安装的 PyTorch 版本。

### `_compat/version.py` 接口

```python
from torch_npu._compat.version import CURRENT_VERSION, MIN_SUPPORTED_VERSION
# CURRENT_VERSION: tuple，如 (2, 11)
# MIN_SUPPORTED_VERSION: tuple，如 (2, 10)
```

### 版本宏（C++）

```cpp
#include "torch_npu/csrc/_compat/version_compat.h"
// TORCH_NPU_VERSION_GE(211)  → True when PyTorch >= 2.11
// TORCH_NPU_VERSION_LT(211)  → True when PyTorch <  2.11
```

### 约束与限制

- `_compat/` 下的文件**不得**被非 `_compat/` 模块反向依赖（即不能在 `_compat/` 中 import 业务模块）。
- 模式 C 的懒加载函数**只能**在实际需要该模块的调用路径上调用，不可在模块初始化阶段触发。
- `MIN_SUPPORTED_VERSION` 修改后，必须在同一 PR 中清理所有对应的过期分支。

---

## 测试设计（Test Plan）

### 单元测试

- **`test_compat_version.py`**：验证 `CURRENT_VERSION` 能正确解析标准版本格式（`2.11.0`、`2.11.0+git123`）及异常格式（预发布后缀、nightly 版本）。
- **`test_compat_imports.py`**：在可用的 PyTorch 版本上验证 `_compat/distributed.py`、`_compat/inductor.py` 中各适配符号可被正常导入和调用。
- **C++ 单元测试**：验证 `TORCH_NPU_VERSION_GE` / `TORCH_NPU_VERSION_LT` 宏在边界值（`210`、`211`、`212`）处的逻辑正确性。

### 集成测试

- **构建矩阵**：CI 针对 v2.10 / v2.11 / v2.12 分别执行 `bash ci/build.sh --torch=X.Y.Z`，验证三个版本均可正常构建并通过现有算子测试套件。

### CI 守护

- **`tools/check_compat.py` 纳入 CI**：在合并前自动扫描，若存在 `MIN_SUPPORTED_VERSION` 已覆盖但未清理的 `COMPAT` 标记，则 CI 失败，阻止过期兼容代码进入主干。
- 当前仅涉及Python修改，可以通过python用例看护，后续如果涉及到C++代码的修改，则依赖针对源码的校验需要一个单独的流程。
- **退出流程回归**：每次更新 `MIN_SUPPORTED_VERSION` 时，要求附带清理 PR，CI 验证清理后三版本构建全部通过。

---

## 缺点与风险（Drawbacks）

### 代码复杂度引入

引入 `_compat/` 层后，符号的 import 路径不再直观，新贡献者需要额外了解兼容规范。

**应对**：在 `_compat/` 目录下维护 `README.md` 说明三种模式的选用规则；CLAUDE.md 中补充说明；代码审查时重点检查 `COMPAT` 注释完整性。

### 过期代码风险

若 CI 扫描脚本未正确同步 `MIN_SUPPORTED_VERSION`，过期兼容代码可能长期残留。每次代码过期需要进行一次全量修改

**应对**：完善注释要求和检查脚本，可以使用AI辅助快速完成此类格式化修改。


---

## 备选方案（Alternatives）

### 方案：使用 `importlib` 动态 import 统一封装，通过`sys._getframe`进行帧注入

通过 `importlib.import_module` 在运行时动态解析所有版本差异，完全消除 if/else。将不同的import对象和实现方法动态注入到当前运行的python帧，实时替换全局和局部对象。

**不选择原因**：
- 动态 import 对静态分析工具（如 mypy、IDE）不友好，丢失类型信息；调试时调用栈更难追踪；
- 相比显式 if/else 可读性更差。
- 引入了不必要的复杂度。整个方法依赖python底层机制稳定，不收python对外接口兼容性和稳定性的保障，后续的升级存在风险，

---

## 未解决问题（Unresolved Questions）

1. **C++ 兼容层的触发时机**：当前 C++ 层（`csrc/_compat/`）为预留目录，暂无内容，具体场景实现仍需验证。

2. **`check_compat.py` 的 C++ 覆盖**：当前扫描脚本仅覆盖 Python 文件（`*.py`）。C++ 文件中的 `CAN REMOVE` 注释是否也应纳入扫描？需要决策扫描规则的正则表达式设计及 CI 集成方式。

3. **版本一致性的约束**：当前的版本判断依赖minor版本，python和C++中仅判断X.Y，对外构建实际涉及到patch版本，X.Y.Z

4. **dev 版本兼容代码的稳定性保证**：支持窗口中的 dev 版（如 v2.12.dev）对应上游尚未稳定的接口，其兼容代码可能频繁变动。分支合一之后，上有版本变动可能导致当前代码的CI流程中dev版本构建失败，从而阻止其合入，CI门禁工程需要对dev版本的构建和测试结果有额外的控制判断。

