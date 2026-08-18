# dsh-unidoc 端到端测试

这是一个由 doc_create 创建、doc_edit 修改过的测试文件，用于验证：

1. **创建**：doc_create 写入
2. **编辑**：doc_edit 替换文本
3. **读取**：doc_read 回读
4. **表格**：| A | B | 渲染

## 代码块

```python
def hello(name: str) -> str:
    return f"Hello, {name}!"
```
