# pkgutil 命名空间包：确保与其他 artifex_nexus 子包合并
__path__ = __import__("pkgutil").extend_path(__path__, __name__)
