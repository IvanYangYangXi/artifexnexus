// 安装清单主表：渲染 7 个顶级条目。
// Install list main table: renders 7 top-level items.

import type { InstallItem } from "./installer.types";
import InstallItemRow from "./InstallItemRow";
import styles from "./InstallList.module.css";

interface InstallListProps {
  items: InstallItem[];
}

/** 主表组件：遍历 items 渲染 InstallItemRow */
function InstallList({ items }: InstallListProps) {
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <InstallItemRow key={item.id} item={item} />
      ))}
    </div>
  );
}

export default InstallList;
