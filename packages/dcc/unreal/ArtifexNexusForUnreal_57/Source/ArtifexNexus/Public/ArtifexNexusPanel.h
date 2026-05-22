// Copyright Artifex Nexus. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"

/**
 * SArtifexNexusPanel - Minimal control panel for Artifex Nexus UE plugin.
 *
 * Provides:
 *   - MCP Server status display + Start/Stop button
 *   - Port indicator
 *   - Trigger enable/disable toggle
 *
 * All Chat/Agent/Skill/Tool management is handled via the Web UI.
 */
class SArtifexNexusPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SArtifexNexusPanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	/** Refresh the displayed status from Subsystem */
	void RefreshStatus();

	/** Start the MCP Server via Python */
	FReply OnStartServer();

	/** Stop the MCP Server via Python */
	FReply OnStopServer();

	/** Toggle triggers on/off */
	FReply OnToggleTriggers();

	/** Get current status text */
	FText GetServerStatusText() const;

	/** Get trigger button text */
	FText GetTriggerButtonText() const;

	/** Subsystem reference */
	class UArtifexNexusSubsystem* Subsystem = nullptr;
};
