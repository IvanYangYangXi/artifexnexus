// Copyright Artifex Nexus. All Rights Reserved.

#include "ArtifexNexusPanel.h"
#include "ArtifexNexusSubsystem.h"

#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SButton.h"
// SMultiLineEditableText not available in UE5.7 — use STextBlock for read-only log
#include "Widgets/SBoxPanel.h"
#include "Styling/AppStyle.h"
#include "Styling/SlateTypes.h"
#include "Editor.h"
#include "IPythonScriptPlugin.h"

DEFINE_LOG_CATEGORY_STATIC(LogArtifexPanel, Log, All)

#define LOCTEXT_NAMESPACE "ArtifexNexus"

void SArtifexNexusPanel::Construct(const FArguments& InArgs)
{
	if (GEditor)
	{
		Subsystem = GEditor->GetEditorSubsystem<UArtifexNexusSubsystem>();
	}

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
		.Padding(16.0f)
		[
			SNew(SVerticalBox)

			// === MCP Server Section ===
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0, 0, 0, 12)
			[
				SNew(SBorder)
				.BorderImage(FAppStyle::GetBrush("DetailsView.CategoryTop"))
				.Padding(12.0f)
				[
					SNew(SVerticalBox)

					+ SVerticalBox::Slot()
					.AutoHeight()
					.Padding(0, 0, 0, 8)
					[
						SNew(STextBlock)
						.Text(LOCTEXT("MCPSection", "MCP Server"))
						.Font(FAppStyle::GetFontStyle("HeadingSmall"))
					]

					+ SVerticalBox::Slot()
					.AutoHeight()
					.Padding(0, 0, 0, 8)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text(LOCTEXT("StatusLabel", "Status: "))
						]
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						.Padding(4, 0, 0, 0)
						[
							SNew(STextBlock)
							.Text(this, &SArtifexNexusPanel::GetServerStatusText)
						]
					]

					+ SVerticalBox::Slot()
					.AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.Padding(0, 0, 8, 0)
						[
							SNew(SButton)
							.Text(LOCTEXT("StartServer", "Start Server"))
							.ToolTipText(LOCTEXT("StartServerTip", "Start the MCP WebSocket server on port 18080"))
							.OnClicked(this, &SArtifexNexusPanel::OnStartServer)
						]
						+ SHorizontalBox::Slot()
						.AutoWidth()
						[
							SNew(SButton)
							.Text(LOCTEXT("StopServer", "Stop Server"))
							.ToolTipText(LOCTEXT("StopServerTip", "Stop the MCP WebSocket server"))
							.OnClicked(this, &SArtifexNexusPanel::OnStopServer)
						]
					]
				]
			]

			// === Trigger Section ===
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0, 0, 0, 12)
			[
				SNew(SBorder)
				.BorderImage(FAppStyle::GetBrush("DetailsView.CategoryTop"))
				.Padding(12.0f)
				[
					SNew(SVerticalBox)

					+ SVerticalBox::Slot()
					.AutoHeight()
					.Padding(0, 0, 0, 8)
					[
						SNew(STextBlock)
						.Text(LOCTEXT("TriggerSection", "Triggers"))
						.Font(FAppStyle::GetFontStyle("HeadingSmall"))
					]

					+ SVerticalBox::Slot()
					.AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text(LOCTEXT("TriggerStatus", "DCC event triggers: "))
						]
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						.Padding(4, 0, 0, 0)
						[
							SNew(SButton)
							.Text(this, &SArtifexNexusPanel::GetTriggerButtonText)
							.ToolTipText(LOCTEXT("TriggerToggleTip", "Enable/disable DCC event triggers"))
							.OnClicked(this, &SArtifexNexusPanel::OnToggleTriggers)
						]
					]
				]
			]

			// === Log Section ===
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			.Padding(0, 0, 0, 12)
			[
				SNew(SBorder)
				.BorderImage(FAppStyle::GetBrush("DetailsView.CategoryTop"))
				.Padding(12.0f)
				[
					SNew(SVerticalBox)

					+ SVerticalBox::Slot()
					.AutoHeight()
					.Padding(0, 0, 0, 8)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.FillWidth(1.0f)
						[
							SNew(STextBlock)
							.Text(LOCTEXT("LogSection", "Event Log"))
							.Font(FAppStyle::GetFontStyle("HeadingSmall"))
						]
						+ SHorizontalBox::Slot()
						.AutoWidth()
						[
							SNew(SButton)
							.Text(LOCTEXT("ClearLog", "Clear"))
							.ToolTipText(LOCTEXT("ClearLogTip", "Clear all log entries"))
							.OnClicked_Lambda([]() -> FReply {
								IPythonScriptPlugin* Py = IPythonScriptPlugin::Get();
								if (Py)
								{
									Py->ExecPythonCommand(TEXT(
										"from artifex_nexus_logger import PanelLogger; PanelLogger.clear()"
									));
								}
								return FReply::Handled();
							})
						]
					]

					+ SVerticalBox::Slot()
					.FillHeight(1.0f)
					[
						SNew(SScrollBox)
						+ SScrollBox::Slot()
						[
							SNew(STextBlock)
							.Text(this, &SArtifexNexusPanel::GetPanelLogText)
							.AutoWrapText(false)
							.Font(FCoreStyle::GetDefaultFontStyle("Mono", 8))
							.ColorAndOpacity(FLinearColor(0.9f, 0.9f, 0.9f))
						]
					]
				]
			]

			// === Info Section (collapsed when log is large) ===
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBorder)
				.BorderImage(FAppStyle::GetBrush("DetailsView.CategoryTop"))
				.Padding(12.0f)
				[
					SNew(STextBlock)
					.Text(LOCTEXT("InfoText",
						"MCP Server runs on ws://localhost:18080\n"
						"Auto-started when the editor loads.\n"
						"Use the buttons above to manually start/stop the server."))
					.AutoWrapText(true)
					.ColorAndOpacity(FSlateColor(FLinearColor(0.6f, 0.6f, 0.6f)))
				]
			]
		]
	];

	// Start periodic log refresh (every 2 seconds)
	LogRefreshHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda([WeakWidget = TWeakPtr<SArtifexNexusPanel>(SharedThis(this))](float Delta) -> bool
		{
			if (TSharedPtr<SArtifexNexusPanel> Pinned = WeakWidget.Pin())
			{
				Pinned->RefreshLogDisplay();
				return true;  // keep ticking
			}
			return false;  // widget destroyed, stop
		}),
		2.0f
	);
}

void SArtifexNexusPanel::RefreshStatusUI()
{
	Invalidate(EInvalidateWidgetReason::Layout);
}

void SArtifexNexusPanel::RefreshLogDisplay()
{
	IPythonScriptPlugin* Py = IPythonScriptPlugin::Get();
	if (!Py)
	{
		return;
	}

	// 使用 EvaluateStatement 模式直接获取返回值，不依赖 print()/stdout 重定向。
	// 关键：绕过 init_unreal 别名（它的 sys.modules 映射可能丢失），直接调用
	// artifex_nexus_logger.PanelLogger.get_recent()，这是一个真正的 Python 模块。
	FPythonCommandEx PythonCmd;
	PythonCmd.Command = TEXT("'\\n'.join(__import__('artifex_nexus_logger').PanelLogger.get_recent(200))");
	PythonCmd.ExecutionMode = EPythonCommandExecutionMode::EvaluateStatement;

	if (Py->ExecPythonCommandEx(PythonCmd))
	{
		CachedLogText = PythonCmd.CommandResult;
		// 触发 Slate 重绘以反映新的日志内容
		Invalidate(EInvalidateWidgetReason::Layout);
	}
}

FText SArtifexNexusPanel::GetServerStatusText() const
{
	if (!Subsystem || !Subsystem->IsValidLowLevel())
	{
		return LOCTEXT("StatusUnknown", "Unknown");
	}

	if (Subsystem->IsServerRunning())
	{
		return FText::Format(
			LOCTEXT("StatusRunning", "Running (port {0})"),
			FText::AsNumber(Subsystem->ServerPort)
		);
	}
	return LOCTEXT("StatusStopped", "Stopped");
}

FText SArtifexNexusPanel::GetTriggerButtonText() const
{
	if (!Subsystem || !Subsystem->IsValidLowLevel())
	{
		return LOCTEXT("TriggerUnknown", "Unknown");
	}
	return Subsystem->AreTriggersEnabled()
		? LOCTEXT("TriggerOn", "Disable Triggers")
		: LOCTEXT("TriggerOff", "Enable Triggers");
}

FReply SArtifexNexusPanel::OnStartServer()
{
	IPythonScriptPlugin* Py = IPythonScriptPlugin::Get();
	if (!Py)
	{
		return FReply::Handled();
	}

	UE_LOG(LogArtifexPanel, Log, TEXT("[ArtifexNexus] Manual start MCP server..."));

	// 使用 EvaluateStatement 模式调用 Python API —
	// __import__() 避免 init_unreal 裸名不存在的问题，
	// start_mcp_server() 内部已处理端口检查、状态同步和日志。
	FPythonCommandEx PythonCmd;
	PythonCmd.Command = TEXT("__import__('init_unreal').start_mcp_server(port=18080)");
	PythonCmd.ExecutionMode = EPythonCommandExecutionMode::EvaluateStatement;
	Py->ExecPythonCommandEx(PythonCmd);

	// Refresh UI after brief delay (server starts async)
	FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda([WeakWidget = TWeakPtr<SArtifexNexusPanel>(SharedThis(this))](float) -> bool {
			if (TSharedPtr<SArtifexNexusPanel> P = WeakWidget.Pin())
			{
				P->RefreshStatusUI();
			}
			return false;
		}),
		1.0f
	);

	return FReply::Handled();
}

FReply SArtifexNexusPanel::OnStopServer()
{
	IPythonScriptPlugin* Py = IPythonScriptPlugin::Get();
	if (!Py)
	{
		return FReply::Handled();
	}

	UE_LOG(LogArtifexPanel, Log, TEXT("[ArtifexNexus] Manual stop MCP server..."));

	// 使用 EvaluateStatement 模式调用 Python API —
	// stop_mcp_server() 内部已处理桥接关闭、状态同步和日志。
	FPythonCommandEx PythonCmd;
	PythonCmd.Command = TEXT("__import__('init_unreal').stop_mcp_server()");
	PythonCmd.ExecutionMode = EPythonCommandExecutionMode::EvaluateStatement;
	Py->ExecPythonCommandEx(PythonCmd);

	FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda([WeakWidget = TWeakPtr<SArtifexNexusPanel>(SharedThis(this))](float) -> bool {
			if (TSharedPtr<SArtifexNexusPanel> P = WeakWidget.Pin())
			{
				P->RefreshStatusUI();
			}
			return false;
		}),
		0.5f
	);

	return FReply::Handled();
}

FReply SArtifexNexusPanel::OnToggleTriggers()
{
	if (Subsystem && Subsystem->IsValidLowLevel())
	{
		Subsystem->SetTriggersEnabled(!Subsystem->AreTriggersEnabled());
	}
	return FReply::Handled();
}

#undef LOCTEXT_NAMESPACE
