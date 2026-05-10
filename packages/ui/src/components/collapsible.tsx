"use client";

/**
 * Collapsible — 折叠容器（基于 Radix Collapsible）
 * Collapsible container based on Radix Collapsible
 *
 * 对齐 docs/specs/ui/component-inventory.md §4
 * 主要场景：C2-A-c 工具卡折叠展开、D3 Tool 列表按 Skill 分组折叠、安装向导日志面板。
 *
 * 使用方式：
 *   <Collapsible>
 *     <CollapsibleTrigger>... 工具调用 (3) ▼</CollapsibleTrigger>
 *     <CollapsibleContent>... 详细内容 ...</CollapsibleContent>
 *   </Collapsible>
 */
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsibleContent = CollapsiblePrimitive.Content;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
