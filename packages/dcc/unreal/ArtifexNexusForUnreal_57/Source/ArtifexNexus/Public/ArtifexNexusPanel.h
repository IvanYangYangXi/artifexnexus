// Copyright Artifex Nexus. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Containers/Ticker.h"

class SArtifexNexusPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SArtifexNexusPanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	void RefreshStatusUI();

	FReply OnStartServer();
	FReply OnStopServer();
	FReply OnToggleTriggers();

	FText GetServerStatusText() const;
	FText GetGatewayStatusText() const;
	FText GetTriggerButtonText() const;

	class UArtifexNexusSubsystem* Subsystem = nullptr;

	/** Cached gateway connection status */
	bool bGatewayConnected = false;
	int32 GatewayClientCount = 0;

	/** Ticker handle for periodic status refresh (gateway connection) */
	FTSTicker::FDelegateHandle StatusRefreshHandle;
};
