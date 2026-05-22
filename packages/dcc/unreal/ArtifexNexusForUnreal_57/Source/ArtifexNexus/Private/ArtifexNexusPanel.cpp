// Copyright Artifex Nexus. All Rights Reserved.

#include "ArtifexNexusPanel.h"
#include "ArtifexNexusSubsystem.h"
#include "IPythonScriptPlugin.h"

#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/SBoxPanel.h"
#include "Styling/AppStyle.h"
#include "Editor.h"

#define LOCTEXT_NAMESPACE "ArtifexNexus"

// ============================================================================
// Panel Construction
// ============================================================================

void SArtifexNexusPanel::Construct(const FArguments& InArgs)
{
    // Get subsystem reference
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

            // === Header ===
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0, 0, 0, 16)
            [
                SNew(STextBlock)
                .Text(LOCTEXT("PanelTitle", "Artifex Nexus - UE Control Panel"))
                .Font(FAppStyle::GetFontStyle("HeadingMedium"))
            ]

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

                    // Section header
                    + SVerticalBox::Slot()
                    .AutoHeight()
                    .Padding(0, 0, 0, 8)
                    [
                        SNew(STextBlock)
                        .Text(LOCTEXT("MCPSection", "MCP Server"))
                        .Font(FAppStyle::GetFontStyle("HeadingSmall"))
                    ]

                    // Status line
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

                    // Buttons
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
                            .ToolTipText(LOCTEXT("TriggerToggleTip", "Enable/disable DCC event triggers (save intercept, etc.)"))
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
                    SNew(SVerticalBox)

                    + SVerticalBox::Slot()
                    .AutoHeight()
                    [
                        SNew(STextBlock)
                        .Text(LOCTEXT("InfoText", "All Chat, Agent, Skill, and Tool management is handled via the Artifex Nexus Web UI.\nMCP Server runs on ws://localhost:18080"))
                        .AutoWrapText(true)
                        .ColorAndOpacity(FSlateColor(FLinearColor(0.6f, 0.6f, 0.6f)))
                    ]
                ]
            ]
        ]
    ];
}

// ============================================================================
// Status Helpers
// ============================================================================

void SArtifexNexusPanel::RefreshStatus()
{
    // No-op: Slate auto-refreshes via attribute bindings
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

// ============================================================================
// Button Handlers
// ============================================================================

FReply SArtifexNexusPanel::OnStartServer()
{
    IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
    if (PythonPlugin)
    {
        PythonPlugin->ExecPythonCommand(TEXT(
            "try:\n"
            "    from init_unreal import start_mcp_server\n"
            "    start_mcp_server(port=18080)\n"
            "except Exception as _e:\n"
            "    import unreal\n"
            "    unreal.log_warning(f'[ArtifexNexus] Failed to start MCP: {_e}')\n"
        ));
    }
    return FReply::Handled();
}

FReply SArtifexNexusPanel::OnStopServer()
{
    IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
    if (PythonPlugin)
    {
        PythonPlugin->ExecPythonCommand(TEXT(
            "try:\n"
            "    from init_unreal import stop_mcp_server\n"
            "    stop_mcp_server()\n"
            "except Exception as _e:\n"
            "    import unreal\n"
            "    unreal.log_warning(f'[ArtifexNexus] Failed to stop MCP: {_e}')\n"
        ));
    }
    return FReply::Handled();
}

FReply SArtifexNexusPanel::OnToggleTriggers()
{
    if (Subsystem && Subsystem->IsValidLowLevel())
    {
        bool bCurrent = Subsystem->AreTriggersEnabled();
        Subsystem->SetTriggersEnabled(!bCurrent);
    }
    return FReply::Handled();
}

#undef LOCTEXT_NAMESPACE
