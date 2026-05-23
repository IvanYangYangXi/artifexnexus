// Copyright Artifex Nexus Contributors. All Rights Reserved.

#include "ArtifexNexusStyle.h"
#include "Interfaces/IPluginManager.h"
#include "Styling/SlateStyleRegistry.h"
#include "Framework/Application/SlateApplication.h"

TSharedPtr<FSlateStyleSet> FArtifexNexusStyle::StyleInstance = nullptr;

void FArtifexNexusStyle::Initialize()
{
	if (!StyleInstance.IsValid())
	{
		StyleInstance = Create();
		FSlateStyleRegistry::RegisterSlateStyle(*StyleInstance);
	}
}

void FArtifexNexusStyle::Shutdown()
{
	FSlateStyleRegistry::UnRegisterSlateStyle(*StyleInstance);
	ensure(StyleInstance.IsUnique());
	StyleInstance.Reset();
}

FName FArtifexNexusStyle::GetStyleSetName()
{
	static FName StyleSetName(TEXT("ArtifexNexusStyle"));
	return StyleSetName;
}

const FVector2D Icon16x16(16.0f, 16.0f);
const FVector2D Icon40x40(40.0f, 40.0f);

TSharedRef<FSlateStyleSet> FArtifexNexusStyle::Create()
{
	TSharedRef<FSlateStyleSet> Style = MakeShareable(new FSlateStyleSet("ArtifexNexusStyle"));

	// CRITICAL: .uplugin name is "ArtifexNexusForUnreal"
	TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin("ArtifexNexusForUnreal");
	if (Plugin.IsValid())
	{
		Style->SetContentRoot(Plugin->GetBaseDir() / TEXT("Resources"));
	}

	// Toolbar icon (40x40)
	// NOTE: Avoid IMAGE_BRUSH macro — in UE 5.7 it causes ambiguous FSlateImageBrush ctor overload.
		Style->Set("ArtifexNexus.PluginAction",
			new FSlateImageBrush(Style->RootToContentDir(TEXT("ButtonIcon40.png")), Icon40x40));

		// Tab icon (16x16) — used in dock tab label
		Style->Set("ArtifexNexus.TabIcon",
			new FSlateImageBrush(Style->RootToContentDir(TEXT("Icon128.png")), Icon16x16));

	return Style;
}

void FArtifexNexusStyle::ReloadTextures()
{
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().GetRenderer()->ReloadTextureResources();
	}
}

const ISlateStyle& FArtifexNexusStyle::Get()
{
	return *StyleInstance;
}
