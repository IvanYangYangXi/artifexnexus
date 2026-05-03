// Copyright Artifex Nexus contributors. SPDX-License-Identifier: Apache-2.0
using UnrealBuildTool;

public class ArtifexNexus : ModuleRules
{
    public ArtifexNexus(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "Slate", "SlateCore",
            "UnrealEd", "EditorStyle", "PythonScriptPlugin"
        });
    }
}
