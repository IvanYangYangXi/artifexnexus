// 抽取 OpenClaw v2026.5.4 schema 中与 EPIC-0001 第二批 spike 相关的节点
// T6: models.* / providers.*  / agents.defaults.*
// T7: web / dashboard / control-ui 相关字段
// T8: agents 节点结构

import { readFileSync, writeFileSync } from "node:fs";

const schema = JSON.parse(readFileSync("docs/specs/_spikes/openclaw-v2026.5.4-config-schema.json", "utf8"));

// schema 顶层是 JSON Schema 文档，properties 才是真正的字段定义
const top = schema.properties || schema;

// 列出所有顶级字段
console.log("=== TOP-LEVEL KEYS ===");
console.log(Object.keys(top).sort().join("\n"));

const interesting = ["models", "providers", "agents", "gateway", "browser", "plugins", "channels", "auth", "dashboard", "web", "controlUi", "control-ui", "ui"];

for (const k of interesting) {
  if (top[k]) {
    const node = top[k];
    console.log(`\n=== ${k} ===`);
    console.log(`type: ${node.type || "(union/ref)"}`);
    if (node.description) console.log(`desc: ${node.description.slice(0, 200)}`);
    if (node.properties) {
      console.log(`properties (${Object.keys(node.properties).length}):`);
      for (const [pk, pv] of Object.entries(node.properties)) {
        const ptype = pv.type || (pv.$ref ? `$ref(${pv.$ref})` : pv.oneOf ? "oneOf" : pv.enum ? `enum(${pv.enum.length})` : "?");
        const pdesc = (pv.description || "").slice(0, 100).replace(/\n/g, " ");
        console.log(`  - ${pk}: ${ptype}${pdesc ? "  // " + pdesc : ""}`);
      }
    }
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
      console.log(`additionalProperties: type=${node.additionalProperties.type || "?"}`);
      if (node.additionalProperties.properties) {
        for (const pk of Object.keys(node.additionalProperties.properties)) {
          console.log(`  - <key>.${pk}`);
        }
      }
    }
  } else {
    console.log(`\n=== ${k} === (not found)`);
  }
}

// 把 models / agents 完整 dump 到独立小文件，避免 1.8MB 太大
const slice = {};
for (const k of ["models", "agents", "providers", "gateway", "browser", "plugins"]) {
  if (top[k]) slice[k] = top[k];
}
writeFileSync("docs/specs/_spikes/openclaw-v2026.5.4-schema-slice.json", JSON.stringify(slice, null, 2));
console.log("\nSliced schema written to docs/specs/_spikes/openclaw-v2026.5.4-schema-slice.json");
