// Copyright Artifex Nexus. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Containers/Ticker.h"

class SScrollBox;

class SArtifexNexusPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SArtifexNexusPanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	void RefreshStatusUI();
	void RefreshLogDisplay();

	FReply OnStartServer();
	FReply OnStopServer();
	FReply OnToggleTriggers();

	FText GetServerStatusText() const;
	FText GetTriggerButtonText() const;
	FText GetPanelLogText() const { return FText::FromString(CachedLogText); }

	class UArtifexNexusSubsystem* Subsystem = nullptr;

	/** Cached log text from Python PanelLogger */
	FString CachedLogText;

	/** Ticker handle for periodic log refresh */
	FTSTicker::FDelegateHandle LogRefreshHandle;
};
