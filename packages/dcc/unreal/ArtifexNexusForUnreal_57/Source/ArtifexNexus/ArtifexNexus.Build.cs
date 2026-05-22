// Copyright Artifex Nexus Contributors. All Rights Reserved.

using UnrealBuildTool;

public class ArtifexNexus : ModuleRules
{
	public ArtifexNexus(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
				"EditorSubsystem",
				"PythonScriptPlugin",
			}
		);

		PrivateDependencyModuleNames.AddRange(
			new string[]
			{
				"CoreUObject",
				"Engine",
				"Slate",
				"SlateCore",
				"UnrealEd",
				"ToolMenus",
				"Projects",
				"InputCore",
				"EditorFramework",
				"AssetRegistry",
				"Json",
				"JsonUtilities",
			}
		);
	}
}
