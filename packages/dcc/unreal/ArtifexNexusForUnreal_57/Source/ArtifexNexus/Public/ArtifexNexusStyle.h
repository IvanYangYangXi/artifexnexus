// Copyright Artifex Nexus Contributors. All Rights Reserved.

#pragma once

#include "Styling/SlateStyle.h"

class FArtifexNexusStyle
{
public:
	static void Initialize();
	static void Shutdown();
	static void ReloadTextures();
	static const ISlateStyle& Get();
	static FName GetStyleSetName();

private:
	static TSharedRef<FSlateStyleSet> Create();

	static TSharedPtr<FSlateStyleSet> StyleInstance;
};
