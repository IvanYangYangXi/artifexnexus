// OpenClaw cron jobs 读取 Tauri Command。
// 直接读取 ~/.artifexnexus/.openclaw/state/cron/jobs.json。
// 文件行数硬上限 300。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ─── 真实文件格式 ──────────────────────────────────────────────────────
// {
//   "version": 1,
//   "jobs": [
//     {
//       "id": "...",
//       "name": "...",
//       "enabled": true,
//       "schedule": { "kind": "cron", "expr": "0 * * * *", "tz": "Asia/Shanghai" }
//     }
//   ]
// }

#[derive(Debug, Deserialize)]
struct CronJobsFile {
    #[serde(default)]
    jobs: Vec<CronJobEntry>,
}

/// schedule 嵌套对象（kind: cron | at）
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CronJobSchedule {
    pub kind: String,
    #[serde(default)]
    pub expr: Option<String>,
    #[serde(default)]
    pub at: Option<String>,
    #[serde(default)]
    pub tz: Option<String>,
}

/// Cron job 条目（与 OpenClaw state/cron/jobs.json 对齐）
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CronJobEntry {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub schedule: Option<CronJobSchedule>,
    #[serde(default)]
    #[serde(rename = "agentId")]
    pub agent_id: Option<String>,
    #[serde(default)]
    #[serde(rename = "sessionKey")]
    pub session_key: Option<String>,
}

/// read_openclaw_cron_jobs 返回体
#[derive(Debug, Serialize, Clone)]
pub struct ReadCronJobsResponse {
    pub ok: bool,
    pub jobs: Vec<CronJobEntry>,
    pub error: Option<String>,
}

/// 读取 OpenClaw 的 cron jobs 列表
#[tauri::command]
pub async fn read_openclaw_cron_jobs() -> Result<ReadCronJobsResponse, String> {
    let cron_path = get_cron_jobs_path();

    match fs::read_to_string(&cron_path) {
        Ok(content) => match serde_json::from_str::<CronJobsFile>(&content) {
            Ok(file) => Ok(ReadCronJobsResponse {
                ok: true,
                jobs: file.jobs,
                error: None,
            }),
            Err(e) => Ok(ReadCronJobsResponse {
                ok: false,
                jobs: vec![],
                error: Some(format!("解析 cron jobs 文件失败: {e}")),
            }),
        },
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(ReadCronJobsResponse {
                    ok: true,
                    jobs: vec![],
                    error: None,
                })
            } else {
                Ok(ReadCronJobsResponse {
                    ok: false,
                    jobs: vec![],
                    error: Some(format!("读取 cron jobs 文件失败: {e}")),
                })
            }
        }
    }
}

fn get_cron_jobs_path() -> PathBuf {
    let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    let base = std::env::var("ARTIFEX_NEXUS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".artifexnexus"));
    base.join(".openclaw").join("state").join("cron").join("jobs.json")
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}
