// Copyright Artifex Nexus. All Rights Reserved.

#include "ArtifexNexusPanel.h"
#include "ArtifexNexusSubsystem.h"

#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Text/SMultiLineEditableText.h"
#include "Widgets/Input/SButton.h"
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
							.Text(LOCTEXT("StatusLabel", "Server: "))
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
					.Padding(0, 0, 0, 8)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text(LOCTEXT("GatewayLabel", "Gateway:  "))
						]
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						.Padding(4, 0, 0, 0)
						[
							SNew(STextBlock)
							.Text(this, &SArtifexNexusPanel::GetGatewayStatusText)
							.ColorAndOpacity_Lambda([this]() -> FSlateColor {
								return bGatewayConnected
									? FLinearColor(0.3f, 1.0f, 0.4f)   // green
									: FLinearColor(1.0f, 0.7f, 0.2f);  // amber
							})
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
							.ButtonColorAndOpacity(this, &SArtifexNexusPanel::GetTriggerButtonColor)
							.ToolTipText(LOCTEXT("TriggerToggleTip", "Enable/disable DCC event triggers"))
							.OnClicked(this, &SArtifexNexusPanel::OnToggleTriggers)
						]
					]
				]
			]

			// === Info Section ===
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

	// Periodic Gateway connection status refresh (every 5 seconds)
	StatusRefreshHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda([WeakWidget = TWeakPtr<SArtifexNexusPanel>(SharedThis(this))](float Delta) -> bool
		{
			if (TSharedPtr<SArtifexNexusPanel> Pinned = WeakWidget.Pin())
			{
				Pinned->RefreshStatusUI();
				return true;
			}
			return false;
		}),
		5.0f
	);
}

void SArtifexNexusPanel::RefreshStatusUI()
{
	// Query Gateway connection status from Python MCP Server
	IPythonScriptPlugin* Py = IPythonScriptPlugin::Get();
	if (Py && Subsystem && Subsystem->IsValidLowLevel() && Subsystem->IsServerRunning())
	{
		// 单行表达式：比多行 try/except 更可靠（UE5 EvaluateStatement 对多行不稳定）
		FPythonCommandEx PythonCmd;
		PythonCmd.Command = TEXT(
			"__import__('ue_mcp_server').get_mcp_server().client_count "
			"if __import__('ue_mcp_server').get_mcp_server() else -1"
		);
		PythonCmd.ExecutionMode = EPythonCommandExecutionMode::EvaluateStatement;

		if (Py->ExecPythonCommandEx(PythonCmd))
		{
			int32 Count = FCString::Atoi(*PythonCmd.CommandResult);
			if (Count >= 0)
			{
				GatewayClientCount = Count;
				bGatewayConnected = (Count > 0);
			}
		}
	}
	else
	{
		bGatewayConnected = false;
		GatewayClientCount = 0;
	}

	Invalidate(EInvalidateWidgetReason::Layout);
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
			LOCTEXT("StatusRunning", "Running (ws://127.0.0.1:{0})"),
			FText::AsNumber(Subsystem->ServerPort)
		);
	}
	return LOCTEXT("StatusStopped", "Stopped");
}

FText SArtifexNexusPanel::GetGatewayStatusText() const
{
	if (!Subsystem || !Subsystem->IsValidLowLevel() || !Subsystem->IsServerRunning())
	{
		return LOCTEXT("GatewayNA", "--");
	}

	if (bGatewayConnected)
	{
		return FText::Format(
			LOCTEXT("GatewayConnected", "Connected ({0} client(s))"),
			FText::AsNumber(GatewayClientCount)
		);
	}
	return LOCTEXT("GatewayWaiting", "Waiting for Gateway...");
}

FText SArtifexNexusPanel::GetTriggerButtonText() const
{
	if (!Subsystem || !Subsystem->IsValidLowLevel())
	{
		return LOCTEXT("TriggerUnknown", "Triggers: Unknown");
	}
	return Subsystem->AreTriggersEnabled()
		? LOCTEXT("TriggerOn", "Triggers: Enabled")
		: LOCTEXT("TriggerOff", "Triggers: Disabled");
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
	// 直接从 ue_mcp_server 导入（not init_unreal → __main__ alias），
	// 避免 UE startup script 的 __main__ 命名空间争议。
	// start_mcp_server() 内部已处理端口检查、状态同步和日志。
	FPythonCommandEx PythonCmd;
	PythonCmd.Command = TEXT("__import__('ue_mcp_server').start_mcp_server(port=18080)");
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
	// 直接从 ue_mcp_server 导入（not init_unreal → __main__ alias），
	// 避免 UE startup script 的 __main__ 命名空间争议。
	// stop_mcp_server() 内部已处理桥接关闭、状态同步和日志。
	FPythonCommandEx PythonCmd;
	PythonCmd.Command = TEXT("__import__('ue_mcp_server').stop_mcp_server()");
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

FSlateColor SArtifexNexusPanel::GetTriggerButtonColor() const
{
	if (!Subsystem || !Subsystem->IsValidLowLevel())
	{
		return FSlateColor(FLinearColor(0.4f, 0.4f, 0.4f, 1.0f)); // Gray = unknown
	}
	return Subsystem->AreTriggersEnabled()
		? FSlateColor(FLinearColor(0.1f, 0.6f, 0.1f, 1.0f))  // Green = enabled
		: FSlateColor(FLinearColor(0.8f, 0.1f, 0.1f, 1.0f)); // Red = disabled
}

#undef LOCTEXT_NAMESPACE
